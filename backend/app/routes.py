"""API routes for Job Hunt Autopilot."""
from __future__ import annotations

import json
import re

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)

from .agent import parse_email
from .analysis_schema import AnalysisResult, RiskFeedback, RiskFeedbackAck
from .analyzer import analyze_email
from .auth import get_current_user_id, verify_scheduler_token
from .config import SAMPLE_DATA_DIR, get_settings
from .email_import import find_duplicates, parse_file
from .firestore_client import get_store
from . import reminder_service
from .models import (
    Application,
    ApplicationCreate,
    ApplicationStatus,
    ApplicationUpdate,
    CommitMessage,
    DraftRequest,
    DraftResponse,
    EmailImport,
    GroupedReminders,
    ImportCommitRequest,
    ImportCommitResult,
    ImportPreview,
    ImportResult,
    ParsedEmail,
    RecalculateResult,
    ReminderRecord,
)

router = APIRouter()

# Extensions we accept for email import.
_ALLOWED_EXTENSIONS = (".json", ".mbox", ".mbx")


# ----------------------------- Applications ------------------------------- #

@router.get("/applications", response_model=list[Application])
def list_applications(user_id: str = Depends(get_current_user_id)):
    return get_store().list_applications(user_id)


@router.post(
    "/applications",
    response_model=Application,
    status_code=status.HTTP_201_CREATED,
)
def create_application(
    payload: ApplicationCreate, user_id: str = Depends(get_current_user_id)
):
    app = Application(
        user_id=user_id,
        company=payload.company,
        role=payload.role,
        status=payload.status,
        notes=payload.notes,
    )
    return get_store().create_application(app)


@router.patch("/applications/{app_id}", response_model=Application)
def update_application(
    app_id: str,
    payload: ApplicationUpdate,
    user_id: str = Depends(get_current_user_id),
):
    updated = get_store().update_application(
        user_id, app_id, payload.model_dump(exclude_unset=True)
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Application not found")
    # A status or interaction-date change starts a new follow-up cycle, so
    # reconcile reminders immediately.
    reminder_service.recalculate_for_application(get_store(), user_id)
    return updated


@router.delete("/applications/{app_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(app_id: str, user_id: str = Depends(get_current_user_id)):
    if not get_store().delete_application(user_id, app_id):
        raise HTTPException(status_code=404, detail="Application not found")


# ------------------------------- Parsing ---------------------------------- #

@router.post("/emails/parse", response_model=ParsedEmail)
def parse_email_endpoint(
    email: EmailImport, _: str = Depends(get_current_user_id)
):
    """Parse a single email without persisting anything."""
    return parse_email(email)


@router.post(
    "/emails/import",
    response_model=ImportResult,
    status_code=status.HTTP_201_CREATED,
)
def import_email(
    email: EmailImport, user_id: str = Depends(get_current_user_id)
):
    """Parse an email and create a tracked application from it."""
    parsed = parse_email(email)
    app = Application(
        user_id=user_id,
        company=parsed.company,
        role=parsed.role,
        status=parsed.status,
        source_email_id=email.id,
        applied_at=email.received_at,
        suspicious=parsed.suspicious,
        suspicious_reasons=parsed.suspicious_reasons,
        notes=parsed.summary,
    )
    created = get_store().create_application(app)
    return ImportResult(parsed=parsed, application=created, created=True)


# ----------------------------- AI analysis -------------------------------- #

@router.post("/analyze", response_model=AnalysisResult)
def analyze(email: EmailImport, _: str = Depends(get_current_user_id)):
    """Analyze a single email with the AI agent (Gemini via ADK/Gen AI SDK).

    Returns a structured, validated AnalysisResult. If Gemini is unavailable
    or returns invalid output, a deterministic fallback is returned with
    verified=False and source="fallback-unverified". The handler is thin:
    all logic lives in app.analyzer.
    """
    return analyze_email(email)


@router.post("/risk-feedback", response_model=RiskFeedbackAck)
def risk_feedback(
    feedback: RiskFeedback, user_id: str = Depends(get_current_user_id)
):
    """Record user feedback on a scam-warning signal (helpful / incorrect).

    Feedback improves transparency and future tuning; it does not change the
    stored assessment. Returns the total count recorded for the user.
    """
    total = get_store().add_risk_feedback(user_id, feedback.model_dump())
    return RiskFeedbackAck(recorded=True, total_feedback=total)


# ------------------------------- Reminders -------------------------------- #

@router.get("/reminders", response_model=GroupedReminders)
def get_reminders(user_id: str = Depends(get_current_user_id)):
    """Return stateful reminders grouped into overdue / due today / upcoming.

    Recalculates first so the response always reflects current applications.
    """
    store = get_store()
    reminder_service.recalculate(store, user_id)
    return reminder_service.group(store, user_id)


@router.post("/reminders/recalculate", response_model=RecalculateResult)
def recalculate_reminders(user_id: str = Depends(get_current_user_id)):
    """Explicitly recompute reminders for the current user."""
    return reminder_service.recalculate(get_store(), user_id)


@router.post("/reminders/{reminder_id}/dismiss", response_model=ReminderRecord)
def dismiss_reminder(
    reminder_id: str, user_id: str = Depends(get_current_user_id)
):
    record = reminder_service.dismiss(get_store(), user_id, reminder_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return record


@router.post("/reminders/draft", response_model=DraftResponse)
def draft_followup(
    req: DraftRequest, user_id: str = Depends(get_current_user_id)
):
    """Generate a short, professional follow-up DRAFT (never sent).

    Accepts either a reminder_id or an application_id. The draft does not
    invent interview outcomes, recruiter promises, or dates.
    """
    store = get_store()
    app_id = req.application_id
    if not app_id and req.reminder_id:
        rec = store.get_reminder(user_id, req.reminder_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="Reminder not found")
        app_id = rec.application_id
    if not app_id:
        raise HTTPException(
            status_code=400,
            detail="Provide a reminder_id or application_id.",
        )
    app = store.get_application(user_id, app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="Application not found")
    return reminder_service.draft_followup(app)


# --------------------------- Scheduler (protected) ------------------------- #

@router.post("/scheduler/run-reminders")
def run_reminders(_: None = Depends(verify_scheduler_token)):
    """Protected endpoint for Google Cloud Scheduler (daily recalculation).

    Authenticated by a shared secret (X-Scheduler-Token). Recalculates
    reminders for every user with applications. Does NOT send any email.
    """
    store = get_store()
    user_ids = {a.user_id for a in store.all_applications()}
    totals = {"users": len(user_ids), "created": 0, "updated": 0, "obsoleted": 0}
    for uid in user_ids:
        res = reminder_service.recalculate(store, uid)
        totals["created"] += res.created
        totals["updated"] += res.updated
        totals["obsoleted"] += res.obsoleted
    return {"status": "ok", **totals}


# ---------------------------- Sample data helper -------------------------- #

@router.get("/sample/emails", response_model=list[EmailImport])
def sample_emails(_: str = Depends(get_current_user_id)):
    """Expose bundled sample emails so the frontend demo works offline."""
    path = SAMPLE_DATA_DIR / "sample_emails.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return [EmailImport.model_validate(e) for e in data]


# ------------------------------ Email import ------------------------------ #

def _validate_upload(file: UploadFile, data: bytes) -> None:
    """Validate extension and size. Raises HTTPException on violation.

    Security: we check the declared extension AND enforce a configurable size
    limit. Content is sniffed by the parser; bodies are never executed.
    """
    settings = get_settings()
    name = (file.filename or "").lower()
    if not name.endswith(_ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported file type. Allowed: "
                + ", ".join(_ALLOWED_EXTENSIONS)
            ),
        )
    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="File is empty."
        )
    if len(data) > settings.max_upload_bytes:
        mb = settings.max_upload_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File exceeds the maximum upload size of {mb:.0f} MiB.",
        )


_AT_COMPANY_RE = re.compile(r"\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})")
_DOMAIN_RE = re.compile(r"@([\w.\-]+)")
_ROLE_RE = re.compile(
    r"(?:for the|for a|the|:)\s*([A-Z][A-Za-z/ ]{2,40}?)\s+"
    r"(?:position|role|at|-)\b"
)


def _derive_company(sender: str, subject: str) -> str:
    """Heuristic company extraction. Deterministic, no AI/Gemini."""
    m = _AT_COMPANY_RE.search(subject or "")
    if m:
        return m.group(1).strip().rstrip(".")
    dm = _DOMAIN_RE.search(sender or "")
    if dm:
        parts = dm.group(1).split(".")
        root = parts[0]
        if root in ("careers", "no", "noreply", "no-reply", "hr", "talent", "jobs"):
            root = parts[-2] if len(parts) >= 2 else root
        return root.capitalize()
    return "Unknown Company"


def _derive_role(subject: str) -> str:
    m = _ROLE_RE.search(subject or "")
    if m:
        role = m.group(1).strip()
        if 2 <= len(role) <= 50:
            return role
    return "Unknown Role"


@router.post("/import/preview", response_model=ImportPreview)
async def import_preview(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Validate + parse an uploaded file WITHOUT saving anything.

    Returns message counts, per-message parse errors, duplicate candidates,
    and the extracted messages for the user to review. Email bodies are not
    sent to Gemini and are not logged.
    """
    data = await file.read()
    _validate_upload(file, data)

    try:
        fmt, messages, errors = parse_file(file.filename or "", data)
    except ValueError as exc:
        # Format-level failure (e.g. malformed JSON / not an mbox).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    existing_ids, existing_fps = get_store().import_keys(user_id)
    duplicates = find_duplicates(messages, existing_ids, existing_fps)

    total = len(messages) + len(errors)
    return ImportPreview(
        format=fmt,
        file_name=file.filename or "",
        total_messages=total,
        parsed_count=len(messages),
        error_count=len(errors),
        duplicate_count=len(duplicates),
        messages=messages,
        errors=errors,
        duplicates=duplicates,
    )


def _commit_to_application(user_id: str, msg: CommitMessage) -> Application:
    """Map an approved message to an Application. Deterministic mapping only —
    no Gemini call during import."""
    company = _derive_company(msg.sender, msg.subject)
    role = _derive_role(msg.subject)
    note = (msg.subject or "").strip()[:140]
    return Application(
        user_id=user_id,
        company=company,
        role=role,
        status=ApplicationStatus.APPLIED,
        source_email_id=msg.message_id,
        applied_at=msg.date,
        notes=note,
        import_fingerprint=msg.fingerprint or None,
    )


@router.post("/import/commit", response_model=ImportCommitResult)
def import_commit(
    payload: ImportCommitRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Persist only the messages the user approved.

    Deduplicates by Message-ID (primary) and fingerprint (fallback) against
    already-stored records and within the batch. Returns imported / skipped /
    failed counts.
    """
    settings = get_settings()
    if len(payload.messages) > settings.max_import_messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Too many messages in one request "
                f"(max {settings.max_import_messages})."
            ),
        )

    store = get_store()
    existing_ids, existing_fps = store.import_keys(user_id)
    seen_ids: set[str] = set()
    seen_fps: set[str] = set()

    to_create: list[Application] = []
    skipped = 0
    failed = 0
    errors: list[str] = []

    for msg in payload.messages:
        try:
            # Dedup: Message-ID precedence, fingerprint fallback.
            if msg.message_id:
                if msg.message_id in existing_ids or msg.message_id in seen_ids:
                    skipped += 1
                    continue
                seen_ids.add(msg.message_id)
            else:
                fp = msg.fingerprint
                if not fp:
                    # Should not happen (preview sets it) but guard anyway.
                    failed += 1
                    errors.append("Message missing both Message-ID and fingerprint.")
                    continue
                if fp in existing_fps or fp in seen_fps:
                    skipped += 1
                    continue
                seen_fps.add(fp)
            to_create.append(_commit_to_application(user_id, msg))
        except Exception:  # noqa: BLE001 - never leak body contents
            failed += 1
            errors.append("Failed to process a message.")

    created = store.bulk_create(to_create) if to_create else []
    return ImportCommitResult(
        imported=len(created),
        skipped=skipped,
        failed=failed,
        imported_ids=[a.id for a in created if a.id],
        errors=errors,
    )
