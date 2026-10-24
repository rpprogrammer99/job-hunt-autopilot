"""Pydantic models for the Job Hunt Autopilot API."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ApplicationStatus(str, Enum):
    APPLIED = "applied"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"
    SUSPICIOUS = "suspicious"


class EmailImport(BaseModel):
    """Raw email payload submitted for parsing/import."""

    id: Optional[str] = None
    from_: str = Field(default="", alias="from")
    subject: str = ""
    body: str = ""
    received_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


class ParsedEmail(BaseModel):
    """Structured result of parsing an email with the agent."""

    company: str = "Unknown"
    role: str = "Unknown"
    status: ApplicationStatus = ApplicationStatus.APPLIED
    suspicious: bool = False
    suspicious_reasons: list[str] = Field(default_factory=list)
    confidence: float = 0.5
    summary: str = ""


class Application(BaseModel):
    id: Optional[str] = None
    user_id: str
    company: str
    role: str
    status: ApplicationStatus = ApplicationStatus.APPLIED
    source_email_id: Optional[str] = None
    applied_at: Optional[datetime] = None
    last_update_at: Optional[datetime] = None
    suspicious: bool = False
    suspicious_reasons: list[str] = Field(default_factory=list)
    notes: str = ""
    # Stable fingerprint used to dedup imported emails that lack a Message-ID.
    import_fingerprint: Optional[str] = None


class ApplicationCreate(BaseModel):
    company: str
    role: str
    status: ApplicationStatus = ApplicationStatus.APPLIED
    notes: str = ""


class ApplicationUpdate(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    status: Optional[ApplicationStatus] = None
    notes: Optional[str] = None


class Reminder(BaseModel):
    application_id: str
    company: str
    role: str
    days_since_update: int
    message: str


# --------------------------------------------------------------------------- #
# Stateful follow-up reminders
# --------------------------------------------------------------------------- #

class ReminderStatus(str, Enum):
    """Lifecycle state of a persisted reminder."""

    OVERDUE = "overdue"  # due date is in the past
    DUE_TODAY = "due_today"  # due date is today
    UPCOMING = "upcoming"  # due date is in the future
    DISMISSED = "dismissed"  # user dismissed it (not shown as actionable)
    OBSOLETE = "obsolete"  # no longer applicable (e.g. app rejected/closed)


class ReminderRecord(BaseModel):
    """A persisted follow-up reminder for one application + follow-up cycle.

    `cycle_key` identifies the current follow-up cycle (base interaction date +
    status). A new cycle (e.g. after the status or interaction date changes)
    gets a new key, which both avoids duplicates within a cycle and lets a
    status change create a fresh reminder.
    """

    id: Optional[str] = None
    user_id: str
    application_id: str
    company: str = ""
    role: str = ""
    # The interaction/application date the 7-day window is measured from.
    base_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    reason: str = ""
    status: ReminderStatus = ReminderStatus.UPCOMING
    suggested_action: str = ""
    cycle_key: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class GroupedReminders(BaseModel):
    """Reminders split into the display buckets required by the UI."""

    overdue: list[ReminderRecord] = Field(default_factory=list)
    due_today: list[ReminderRecord] = Field(default_factory=list)
    upcoming: list[ReminderRecord] = Field(default_factory=list)
    dismissed: list[ReminderRecord] = Field(default_factory=list)


class RecalculateResult(BaseModel):
    created: int
    updated: int
    obsoleted: int
    total_active: int


class DraftRequest(BaseModel):
    """Request a follow-up draft for a reminder (or raw application context)."""

    reminder_id: Optional[str] = None
    application_id: Optional[str] = None


class DraftResponse(BaseModel):
    subject: str
    body: str
    source: str  # "gemini" or "fallback-template"
    disclaimer: str = (
        "Draft only. Review and send it yourself — nothing is emailed "
        "automatically. The draft avoids inventing outcomes, promises, or dates."
    )


class ImportResult(BaseModel):
    parsed: ParsedEmail
    application: Application
    created: bool


# --------------------------------------------------------------------------- #
# Email import (JSON / MBOX) models
# --------------------------------------------------------------------------- #

class ImportFormat(str, Enum):
    JSON = "json"
    MBOX = "mbox"


class ParsedMessage(BaseModel):
    """A normalized email message extracted from an uploaded file.

    `fingerprint` is a stable hash used for duplicate detection when a
    Message-ID is not present. Bodies are treated as untrusted text and are
    never executed or logged in full.
    """

    message_id: Optional[str] = None
    sender: str = ""
    recipient: str = ""
    subject: str = ""
    date: Optional[datetime] = None
    body: str = ""
    source: str = ""
    fingerprint: str = ""
    # Index within the uploaded file (helps the UI reference messages).
    index: int = 0


class MessageParseError(BaseModel):
    index: int
    error: str


class DuplicateCandidate(BaseModel):
    index: int
    reason: str  # "message_id" | "fingerprint"
    key: str


class ImportPreview(BaseModel):
    format: ImportFormat
    file_name: str
    total_messages: int
    parsed_count: int
    error_count: int
    duplicate_count: int
    messages: list[ParsedMessage] = Field(default_factory=list)
    errors: list[MessageParseError] = Field(default_factory=list)
    duplicates: list[DuplicateCandidate] = Field(default_factory=list)


class CommitMessage(BaseModel):
    """A message the user approved for import. Mirrors ParsedMessage fields
    the client received from the preview step."""

    message_id: Optional[str] = None
    sender: str = ""
    recipient: str = ""
    subject: str = ""
    date: Optional[datetime] = None
    body: str = ""
    source: str = ""
    fingerprint: str = ""


class ImportCommitRequest(BaseModel):
    messages: list[CommitMessage] = Field(default_factory=list)


class ImportCommitResult(BaseModel):
    imported: int
    skipped: int
    failed: int
    imported_ids: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
