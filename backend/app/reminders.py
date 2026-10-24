"""Seven-day follow-up reminder logic (pure helpers).

Rules implemented here:
  * The 7-day window is measured from the ACTUAL application / last meaningful
    recruiter-interaction date when available (`last_update_at` preferred, else
    `applied_at`).
  * An application with no reply for >= 7 days becomes due for follow-up.
  * Rejected (and other closed) applications never get reminders.
  * A "cycle key" identifies the current follow-up cycle so duplicates are not
    created within a cycle, and a status / interaction-date change starts a new
    cycle.

These functions are pure (no I/O) so they are easy to unit test. The stateful
orchestration (persistence, dedup, dismissals) lives in reminder_service.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .models import (
    Application,
    ApplicationStatus,
    Reminder,
    ReminderRecord,
    ReminderStatus,
)

REMINDER_THRESHOLD_DAYS = 7

# Applications that are still "open" and worth following up on.
_OPEN_STATUSES = {ApplicationStatus.APPLIED, ApplicationStatus.INTERVIEW}
# Applications that must NEVER generate a reminder.
_CLOSED_STATUSES = {
    ApplicationStatus.REJECTED,
    ApplicationStatus.OFFER,
    ApplicationStatus.SUSPICIOUS,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def base_interaction_date(app: Application) -> datetime | None:
    """The date the 7-day window is measured from.

    Prefers the last meaningful interaction (`last_update_at`), falling back to
    the application date.
    """
    return _aware(app.last_update_at or app.applied_at)


def is_eligible(app: Application) -> bool:
    """True if the application can have a follow-up reminder at all."""
    if app.suspicious:
        return False
    if app.status in _CLOSED_STATUSES:
        return False
    return app.status in _OPEN_STATUSES


def compute_due_date(app: Application) -> datetime | None:
    """Due date = base interaction date + 7 days."""
    base = base_interaction_date(app)
    if base is None:
        return None
    return base + timedelta(days=REMINDER_THRESHOLD_DAYS)


def reminder_state(due_date: datetime, now: datetime | None = None) -> ReminderStatus:
    """Classify an active reminder as overdue / due today / upcoming."""
    now = now or _now()
    due = _aware(due_date)
    assert due is not None
    if due.date() < now.date():
        return ReminderStatus.OVERDUE
    if due.date() == now.date():
        return ReminderStatus.DUE_TODAY
    return ReminderStatus.UPCOMING


def cycle_key(app: Application) -> str:
    """Identity of the current follow-up cycle for an application.

    Combines the application id, its status, and the base interaction date.
    When the status or interaction date changes, the key changes -> a new
    cycle (and a new reminder) is produced, and recalculation within the same
    cycle is idempotent (no duplicates).
    """
    base = base_interaction_date(app)
    base_token = base.date().isoformat() if base else "none"
    return f"{app.id or 'unknown'}|{app.status.value}|{base_token}"


def default_suggested_action(app: Application) -> str:
    return (
        f"Send a short, polite follow-up about your {app.role} application at "
        f"{app.company}."
    )


def build_reminder_record(
    app: Application, now: datetime | None = None
) -> ReminderRecord | None:
    """Build a (stateless) ReminderRecord for an eligible, due application.

    Returns None if the application is ineligible or not yet due.
    """
    now = now or _now()
    if not is_eligible(app):
        return None
    due = compute_due_date(app)
    if due is None:
        return None
    # Only create a record once it is due today or overdue; upcoming reminders
    # are still represented so the UI can show them.
    state = reminder_state(due, now)
    days = (now.date() - _aware(due).date()).days
    if state == ReminderStatus.OVERDUE:
        reason = (
            f"No reply for over a week — follow-up was due {days} day"
            f"{'s' if days != 1 else ''} ago."
        )
    elif state == ReminderStatus.DUE_TODAY:
        reason = "It has been 7 days with no reply — follow-up is due today."
    else:
        days_until = (_aware(due).date() - now.date()).days
        reason = (
            f"Follow-up suggested in {days_until} day"
            f"{'s' if days_until != 1 else ''} if there is no reply."
        )
    return ReminderRecord(
        user_id=app.user_id,
        application_id=app.id or "",
        company=app.company,
        role=app.role,
        base_date=base_interaction_date(app),
        due_date=due,
        reason=reason,
        status=state,
        suggested_action=default_suggested_action(app),
        cycle_key=cycle_key(app),
    )


def is_due(app: Application, now: datetime | None = None) -> bool:
    """True if the application is eligible AND at/over the 7-day threshold."""
    if not is_eligible(app):
        return False
    due = compute_due_date(app)
    if due is None:
        return False
    return reminder_state(due, now) in (
        ReminderStatus.OVERDUE,
        ReminderStatus.DUE_TODAY,
    )


# --------------------------------------------------------------------------- #
# Legacy helpers (kept for backward compatibility with existing callers/tests)
# --------------------------------------------------------------------------- #

def days_since_update(app: Application, now: datetime | None = None) -> int:
    now = now or _now()
    ref = base_interaction_date(app)
    if ref is None:
        return 0
    return max((now - ref).days, 0)


def needs_reminder(app: Application, now: datetime | None = None) -> bool:
    if not is_eligible(app):
        return False
    return days_since_update(app, now) >= REMINDER_THRESHOLD_DAYS


def build_reminders(
    apps: list[Application], now: datetime | None = None
) -> list[Reminder]:
    now = now or _now()
    reminders: list[Reminder] = []
    for app in apps:
        if needs_reminder(app, now):
            d = days_since_update(app, now)
            reminders.append(
                Reminder(
                    application_id=app.id or "",
                    company=app.company,
                    role=app.role,
                    days_since_update=d,
                    message=(
                        f"It's been {d} days since your last update on the "
                        f"{app.role} role at {app.company}. Consider sending a "
                        f"polite follow-up."
                    ),
                )
            )
    return reminders
