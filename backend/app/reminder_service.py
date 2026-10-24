"""Stateful reminder orchestration over the data store.

Responsibilities:
  * recalculate(user_id): create/update/obsolete persisted reminders for a
    user's applications. Deduplicates by follow-up cycle, never creates a
    reminder for a rejected/closed application, and PRESERVES user dismissals.
  * group(user_id): return reminders bucketed into overdue / due today /
    upcoming / dismissed (statuses refreshed against "now").
  * dismiss(user_id, reminder_id): mark a reminder dismissed.
  * recalculate_for_application(...): called when an application's status or
    interaction date changes.
  * draft_followup(...): Gemini-drafted (or template) follow-up message that
    never invents interview outcomes, recruiter promises, or dates.

Nothing here sends email. Drafts are returned for the user to copy/approve.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .config import get_settings
from .models import (
    Application,
    DraftResponse,
    GroupedReminders,
    RecalculateResult,
    ReminderRecord,
    ReminderStatus,
)
from .reminders import (
    build_reminder_record,
    cycle_key,
    is_eligible,
    reminder_state,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Recalculation
# --------------------------------------------------------------------------- #

def recalculate(store, user_id: str, now: datetime | None = None) -> RecalculateResult:
    """Reconcile persisted reminders with the user's current applications.

    Dedup: at most one reminder per (application, follow-up cycle). A status or
    interaction-date change yields a new cycle_key -> the old reminder is
    marked obsolete and a fresh one is created.
    Dismissals are preserved: a dismissed reminder for the SAME cycle stays
    dismissed and is not recreated.
    """
    now = now or _now()
    apps = store.list_applications(user_id)
    existing = store.list_reminders(user_id)
    by_cycle: dict[str, ReminderRecord] = {
        r.cycle_key: r for r in existing if r.cycle_key
    }

    created = updated = obsoleted = 0
    live_cycle_keys: set[str] = set()

    for app in apps:
        if not is_eligible(app):
            continue
        key = cycle_key(app)
        live_cycle_keys.add(key)
        candidate = build_reminder_record(app, now)
        if candidate is None:
            continue

        prior = by_cycle.get(key)
        if prior is None:
            # New cycle -> create a reminder.
            store.upsert_reminder(candidate)
            created += 1
        elif prior.status == ReminderStatus.DISMISSED:
            # Preserve the user's dismissal for this cycle; do not revive it.
            continue
        else:
            # Same cycle -> refresh fields/status in place (no duplicate).
            prior.status = candidate.status
            prior.reason = candidate.reason
            prior.due_date = candidate.due_date
            prior.base_date = candidate.base_date
            prior.company = candidate.company
            prior.role = candidate.role
            prior.suggested_action = candidate.suggested_action
            store.upsert_reminder(prior)
            updated += 1

    # Obsolete reminders whose cycle no longer exists (status/date changed, or
    # the application became ineligible) and that the user hasn't dismissed.
    for r in existing:
        if r.cycle_key in live_cycle_keys:
            continue
        if r.status in (ReminderStatus.DISMISSED, ReminderStatus.OBSOLETE):
            continue
        r.status = ReminderStatus.OBSOLETE
        store.upsert_reminder(r)
        obsoleted += 1

    active = [
        r
        for r in store.list_reminders(user_id)
        if r.status
        in (
            ReminderStatus.OVERDUE,
            ReminderStatus.DUE_TODAY,
            ReminderStatus.UPCOMING,
        )
    ]
    return RecalculateResult(
        created=created,
        updated=updated,
        obsoleted=obsoleted,
        total_active=len(active),
    )


def recalculate_for_application(store, user_id: str, now: datetime | None = None):
    """Hook invoked when an application changes (status/interaction date).

    Simply re-runs the full reconciliation for the user, which handles the
    new cycle and obsoletes the previous one.
    """
    return recalculate(store, user_id, now)


# --------------------------------------------------------------------------- #
# Grouping
# --------------------------------------------------------------------------- #

def group(store, user_id: str, now: datetime | None = None) -> GroupedReminders:
    """Return reminders split into display buckets, refreshing live statuses."""
    now = now or _now()
    grouped = GroupedReminders()
    for r in store.list_reminders(user_id):
        if r.status == ReminderStatus.DISMISSED:
            grouped.dismissed.append(r)
            continue
        if r.status == ReminderStatus.OBSOLETE:
            continue
        # Refresh the active status against "now" so the buckets are current.
        if r.due_date is not None:
            r.status = reminder_state(r.due_date, now)
        if r.status == ReminderStatus.OVERDUE:
            grouped.overdue.append(r)
        elif r.status == ReminderStatus.DUE_TODAY:
            grouped.due_today.append(r)
        else:
            grouped.upcoming.append(r)

    grouped.overdue.sort(key=lambda r: r.due_date or now)
    grouped.due_today.sort(key=lambda r: r.due_date or now)
    grouped.upcoming.sort(key=lambda r: r.due_date or now)
    return grouped


# --------------------------------------------------------------------------- #
# Dismiss
# --------------------------------------------------------------------------- #

def dismiss(store, user_id: str, reminder_id: str) -> Optional[ReminderRecord]:
    record = store.get_reminder(user_id, reminder_id)
    if record is None:
        return None
    record.status = ReminderStatus.DISMISSED
    return store.upsert_reminder(record)


# --------------------------------------------------------------------------- #
# Follow-up draft generation (Gemini + safe fallback)
# --------------------------------------------------------------------------- #

_DRAFT_SYSTEM_INSTRUCTION = """\
You draft a SHORT, professional job-application follow-up email on behalf of a
candidate. Hard rules:
- Do NOT invent interview outcomes, recruiter promises, next steps, dates,
  times, or compensation. Only reference facts given in the context.
- Keep it concise (3-5 sentences), polite, and specific to the role/company.
- Do not claim the candidate was offered or promised anything.
- Output JSON with keys: subject (string), body (string). No extra commentary.
- The email text you draft is for the USER to review and send manually.
"""


def _template_draft(app: Application) -> DraftResponse:
    """Deterministic, safe fallback draft. Invents nothing."""
    company = app.company or "the company"
    role = app.role or "the role"
    subject = f"Following up on my application for {role}"
    body = (
        f"Hello,\n\n"
        f"I hope you are well. I'm writing to follow up on my application for "
        f"the {role} position at {company}. I remain very interested in the "
        f"opportunity and would be glad to provide any additional information "
        f"that would be helpful.\n\n"
        f"Thank you for your time and consideration.\n\n"
        f"Best regards"
    )
    return DraftResponse(subject=subject, body=body, source="fallback-template")


def _gemini_draft(app: Application) -> Optional[DraftResponse]:
    settings = get_settings()
    if not settings.gemini_available:
        return None
    try:
        import json

        from google import genai
        from google.genai import types

        if settings.google_genai_use_vertexai:
            client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        else:
            client = genai.Client(api_key=settings.google_api_key)

        # Only pass neutral, known facts. No outcomes/promises/dates invented.
        context = (
            f"Company: {app.company or 'unknown'}\n"
            f"Role: {app.role or 'unknown'}\n"
            f"Current status (for your awareness only, do not state it as a "
            f"promise): {app.status.value}\n"
            "Write the follow-up now."
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=context,
            config=types.GenerateContentConfig(
                system_instruction=_DRAFT_SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                temperature=0.3,
            ),
        )
        text = getattr(response, "text", "") or ""
        data = json.loads(text) if text.strip().startswith("{") else None
        if not data or "body" not in data:
            return None
        return DraftResponse(
            subject=str(data.get("subject", f"Following up — {app.role}")),
            body=str(data["body"]),
            source="gemini",
        )
    except Exception:  # noqa: BLE001 - any failure -> safe template
        return None


def draft_followup(app: Application) -> DraftResponse:
    """Return a follow-up draft, preferring Gemini and falling back to a safe
    template. Never sends anything."""
    return _gemini_draft(app) or _template_draft(app)
