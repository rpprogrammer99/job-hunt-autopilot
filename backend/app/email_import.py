"""Email import parsing (JSON + MBOX).

Security posture:
  * Email bodies are treated as UNTRUSTED text. We never eval/exec/deserialize
    them as code, and we never pass them to Gemini during import.
  * We never log full bodies or other sensitive content (see `safe_summary`).
  * Parsing uses only the Python standard library (`json`, `email`, `mailbox`).

The functions here are pure and import-free of FastAPI so they are easy to
unit test directly.
"""
from __future__ import annotations

import email
import email.utils
import hashlib
import json
import mailbox
import re
import tempfile
from datetime import datetime, timezone
from email.message import Message
from pathlib import Path
from typing import Optional

from .models import (
    DuplicateCandidate,
    ImportFormat,
    MessageParseError,
    ParsedMessage,
)

# Maximum characters of a body we retain. Keeps payloads bounded and avoids
# storing enormous untrusted blobs. Bodies are never logged in full.
MAX_BODY_CHARS = 20_000

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def safe_summary(message_id: Optional[str], subject: str) -> str:
    """A log-safe identifier for a message. Never includes the body."""
    mid = (message_id or "<no-id>")[:120]
    subj = (subject or "")[:60]
    return f"msg id={mid} subject={subj!r}"


def _strip_html(html: str) -> str:
    text = _HTML_TAG_RE.sub(" ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    return _WS_RE.sub(" ", text).strip()


def _clip_body(body: str) -> str:
    body = body or ""
    return body[:MAX_BODY_CHARS]


def _parse_date(value: object) -> Optional[datetime]:
    """Parse an RFC-2822 or ISO date string into an aware datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    s = str(value).strip()
    # Try RFC 2822 (typical email Date header).
    try:
        dt = email.utils.parsedate_to_datetime(s)
        if dt is not None:
            return dt
    except (TypeError, ValueError, IndexError):
        pass
    # Try ISO 8601.
    try:
        iso = s.replace("Z", "+00:00")
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def compute_fingerprint(
    sender: str, subject: str, date: Optional[datetime], body: str
) -> str:
    """Stable SHA-256 fingerprint used when a Message-ID is absent.

    Normalizes inputs so trivial whitespace/case differences don't defeat
    dedup. Uses only a bounded prefix of the body.
    """
    norm_sender = (sender or "").strip().lower()
    norm_subject = _WS_RE.sub(" ", (subject or "").strip().lower())
    norm_date = date.astimezone(timezone.utc).isoformat() if date else ""
    norm_body = _WS_RE.sub(" ", (body or "").strip())[:1000]
    basis = "\x1f".join([norm_sender, norm_subject, norm_date, norm_body])
    return hashlib.sha256(basis.encode("utf-8", "replace")).hexdigest()


def _normalize_message_id(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    mid = str(raw).strip()
    return mid or None


def _finalize(msg: ParsedMessage) -> ParsedMessage:
    """Attach a fingerprint if there is no Message-ID."""
    msg.body = _clip_body(msg.body)
    if not msg.fingerprint:
        msg.fingerprint = compute_fingerprint(
            msg.sender, msg.subject, msg.date, msg.body
        )
    return msg


# --------------------------------------------------------------------------- #
# JSON parsing
# --------------------------------------------------------------------------- #

# Field aliases accepted in JSON input (defensive, case-insensitive handled
# by lookups below).
_JSON_FIELD_ALIASES = {
    "message_id": ("message_id", "messageId", "Message-ID", "message-id", "id"),
    "sender": ("sender", "from", "From"),
    "recipient": ("recipient", "to", "To"),
    "subject": ("subject", "Subject"),
    "date": ("date", "Date", "received_at", "receivedAt"),
    "body": ("body", "text", "content"),
    "source": ("source", "Source"),
}


def _pick(obj: dict, field: str) -> Optional[object]:
    for key in _JSON_FIELD_ALIASES[field]:
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
    return None


def parse_json_bytes(
    data: bytes,
) -> tuple[list[ParsedMessage], list[MessageParseError]]:
    """Parse a JSON array of email objects.

    Returns (messages, errors). Raises ValueError only for a fundamentally
    invalid document (not an array / not JSON); per-record issues become
    entries in `errors`.
    """
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"File is not valid UTF-8 text: {exc}") from exc

    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed JSON: {exc.msg} (line {exc.lineno})") from exc

    if isinstance(doc, dict) and isinstance(doc.get("emails"), list):
        doc = doc["emails"]
    if not isinstance(doc, list):
        raise ValueError("Expected a JSON array of email objects.")

    messages: list[ParsedMessage] = []
    errors: list[MessageParseError] = []

    for i, raw in enumerate(doc):
        if not isinstance(raw, dict):
            errors.append(
                MessageParseError(index=i, error="Record is not an object.")
            )
            continue
        try:
            subject = str(_pick(raw, "subject") or "")
            sender = str(_pick(raw, "sender") or "")
            body = str(_pick(raw, "body") or "")
            # A message with no identifying content at all is an error.
            if not any([subject, sender, body, _pick(raw, "message_id")]):
                errors.append(
                    MessageParseError(
                        index=i,
                        error="Missing required fields (need at least one of "
                        "subject, sender, body, or message_id).",
                    )
                )
                continue
            msg = ParsedMessage(
                message_id=_normalize_message_id(
                    str(_pick(raw, "message_id")) if _pick(raw, "message_id") else None
                ),
                sender=sender,
                recipient=str(_pick(raw, "recipient") or ""),
                subject=subject,
                date=_parse_date(_pick(raw, "date")),
                body=body,
                source=str(_pick(raw, "source") or "json"),
                index=i,
            )
            messages.append(_finalize(msg))
        except Exception as exc:  # noqa: BLE001 - never leak body in error
            errors.append(
                MessageParseError(index=i, error=f"Could not parse record: {exc}")
            )

    return messages, errors


# --------------------------------------------------------------------------- #
# MBOX parsing
# --------------------------------------------------------------------------- #

def _extract_plain_body(msg: Message) -> str:
    """Return the message body, preferring text/plain over text/html.

    Email payloads are untrusted bytes; we only decode them to text.
    """
    plain: Optional[str] = None
    html: Optional[str] = None

    if msg.is_multipart():
        for part in msg.walk():
            if part.is_multipart():
                continue
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp.lower():
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                text = payload.decode(charset, "replace")
            except (LookupError, UnicodeDecodeError):
                text = payload.decode("utf-8", "replace")
            if ctype == "text/plain" and plain is None:
                plain = text
            elif ctype == "text/html" and html is None:
                html = text
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        if payload is not None:
            try:
                text = payload.decode(charset, "replace")
            except (LookupError, UnicodeDecodeError):
                text = payload.decode("utf-8", "replace")
        else:
            text = msg.get_payload() if isinstance(msg.get_payload(), str) else ""
        if msg.get_content_type() == "text/html":
            html = text
        else:
            plain = text

    if plain is not None and plain.strip():
        return plain.strip()
    if html is not None and html.strip():
        return _strip_html(html)
    return ""


def _message_to_parsed(msg: Message, index: int) -> ParsedMessage:
    body = _extract_plain_body(msg)
    parsed = ParsedMessage(
        message_id=_normalize_message_id(msg.get("Message-ID")),
        sender=str(msg.get("From") or ""),
        recipient=str(msg.get("To") or ""),
        subject=str(msg.get("Subject") or ""),
        date=_parse_date(msg.get("Date")),
        body=body,
        source="mbox",
        index=index,
    )
    return _finalize(parsed)


def parse_mbox_bytes(
    data: bytes,
) -> tuple[list[ParsedMessage], list[MessageParseError]]:
    """Parse an MBOX file using the standard-library `mailbox` module.

    `mailbox.mbox` needs a path, so we write to a secure temp file that is
    always cleaned up.
    """
    messages: list[ParsedMessage] = []
    errors: list[MessageParseError] = []

    tmp_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".mbox", delete=False
        ) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)

        box = mailbox.mbox(str(tmp_path))
        try:
            keys = list(box.keys())
            if not keys:
                # Could be an empty or non-mbox file.
                if data.strip() and not data.lstrip().startswith(b"From "):
                    raise ValueError(
                        "File does not look like an MBOX mailbox "
                        "(no 'From ' message separators found)."
                    )
            for i, key in enumerate(keys):
                try:
                    messages.append(_message_to_parsed(box[key], i))
                except Exception as exc:  # noqa: BLE001
                    errors.append(
                        MessageParseError(
                            index=i, error=f"Could not parse message: {exc}"
                        )
                    )
        finally:
            box.close()
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink()
            except OSError:
                pass

    return messages, errors


# --------------------------------------------------------------------------- #
# Format detection + dispatch
# --------------------------------------------------------------------------- #

def detect_format(file_name: str, data: bytes) -> ImportFormat:
    """Choose a parser based on extension, then content sniffing."""
    name = (file_name or "").lower()
    if name.endswith(".json"):
        return ImportFormat.JSON
    if name.endswith((".mbox", ".mbx")):
        return ImportFormat.MBOX
    # Sniff content.
    head = data.lstrip()[:1]
    if head in (b"[", b"{"):
        return ImportFormat.JSON
    return ImportFormat.MBOX


def parse_file(
    file_name: str, data: bytes, fmt: Optional[ImportFormat] = None
) -> tuple[ImportFormat, list[ParsedMessage], list[MessageParseError]]:
    fmt = fmt or detect_format(file_name, data)
    if fmt is ImportFormat.JSON:
        msgs, errs = parse_json_bytes(data)
    else:
        msgs, errs = parse_mbox_bytes(data)
    return fmt, msgs, errs


# --------------------------------------------------------------------------- #
# Duplicate detection
# --------------------------------------------------------------------------- #

def find_duplicates(
    messages: list[ParsedMessage],
    existing_message_ids: set[str],
    existing_fingerprints: set[str],
) -> list[DuplicateCandidate]:
    """Flag messages that duplicate already-stored records OR earlier messages
    within the same batch. Message-ID takes precedence over fingerprint.
    """
    seen_ids: set[str] = set()
    seen_fps: set[str] = set()
    dups: list[DuplicateCandidate] = []

    for msg in messages:
        if msg.message_id:
            if msg.message_id in existing_message_ids or msg.message_id in seen_ids:
                dups.append(
                    DuplicateCandidate(
                        index=msg.index, reason="message_id", key=msg.message_id
                    )
                )
                continue
            seen_ids.add(msg.message_id)
        else:
            fp = msg.fingerprint
            if fp in existing_fingerprints or fp in seen_fps:
                dups.append(
                    DuplicateCandidate(
                        index=msg.index, reason="fingerprint", key=fp
                    )
                )
                continue
            seen_fps.add(fp)
    return dups
