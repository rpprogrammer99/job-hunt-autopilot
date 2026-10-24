"""Tests for email importing (JSON + MBOX), covering:
valid JSON, valid MBOX, malformed files, missing fields, duplicates, oversized.

Covers both the pure parsing layer (app.email_import) and the HTTP endpoints
(/api/import/preview, /api/import/commit).
"""
import json
import textwrap

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.email_import import (
    compute_fingerprint,
    find_duplicates,
    parse_json_bytes,
    parse_mbox_bytes,
    parse_file,
)
from app.main import app
from app.models import ImportFormat

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #

VALID_JSON = json.dumps(
    [
        {
            "message_id": "<json-1@acme.com>",
            "sender": "careers@acmecloud.com",
            "recipient": "me@example.com",
            "subject": "Thank you for applying to Acme Cloud",
            "date": "2026-10-15T08:45:00Z",
            "body": "We received your application for the Software Engineer position.",
            "source": "gmail",
        },
        {
            "sender": "talent@finchpay.com",
            "subject": "We received your application - Backend Engineer",
            "date": "Thu, 16 Oct 2026 16:45:00 +0000",
            "body": "Confirmation that your application was received.",
        },
    ]
).encode()

VALID_MBOX = textwrap.dedent(
    """\
    From bounce@acme.com Mon Oct 15 08:45:00 2026
    Message-ID: <mbox-1@acme.com>
    From: careers@acmecloud.com
    To: me@example.com
    Subject: Thank you for applying
    Date: Thu, 15 Oct 2026 08:45:00 +0000
    Content-Type: text/plain

    We received your application. This is the plain text body.

    From bounce@brightwave.io Fri Oct 16 10:00:00 2026
    Message-ID: <mbox-2@brightwave.io>
    From: recruiting@brightwave.io
    To: me@example.com
    Subject: Interview invitation
    Date: Fri, 16 Oct 2026 10:00:00 +0000
    Content-Type: text/html

    <html><body><p>We would like to <b>interview</b> you.</p></body></html>
    """
).encode()


def _upload(name: str, data: bytes, content_type: str):
    return {"file": (name, data, content_type)}


# --------------------------------------------------------------------------- #
# Pure parser tests
# --------------------------------------------------------------------------- #

def test_parse_valid_json():
    messages, errors = parse_json_bytes(VALID_JSON)
    assert len(messages) == 2
    assert errors == []
    assert messages[0].message_id == "<json-1@acme.com>"
    assert messages[0].sender == "careers@acmecloud.com"
    assert messages[0].date is not None
    # Fallback fingerprint computed for record without a message_id.
    assert messages[1].message_id is None
    assert messages[1].fingerprint


def test_parse_valid_mbox_prefers_plain_and_strips_html():
    messages, errors = parse_mbox_bytes(VALID_MBOX)
    assert len(messages) == 2
    assert errors == []
    # First message: plain text preserved.
    assert "plain text body" in messages[0].body
    assert messages[0].subject == "Thank you for applying"
    # Second message: HTML stripped to text (no tags).
    assert "<" not in messages[1].body
    assert "interview" in messages[1].body.lower()


def test_parse_json_missing_fields_reports_error():
    data = json.dumps([{"source": "x"}, {"subject": "Valid one"}]).encode()
    messages, errors = parse_json_bytes(data)
    # First record has no identifying content -> error. Second is fine.
    assert len(errors) == 1
    assert errors[0].index == 0
    assert "Missing required fields" in errors[0].error
    assert len(messages) == 1


def test_parse_malformed_json_raises():
    with pytest.raises(ValueError, match="Malformed JSON"):
        parse_json_bytes(b"{not valid json")


def test_parse_json_not_an_array_raises():
    with pytest.raises(ValueError, match="array"):
        parse_json_bytes(json.dumps({"foo": "bar"}).encode())


def test_detect_format_dispatch():
    fmt_json, msgs_json, _ = parse_file("emails.json", VALID_JSON)
    fmt_mbox, msgs_mbox, _ = parse_file("mailbox.mbox", VALID_MBOX)
    assert fmt_json is ImportFormat.JSON and len(msgs_json) == 2
    assert fmt_mbox is ImportFormat.MBOX and len(msgs_mbox) == 2


def test_fingerprint_is_stable_and_deduplicates():
    fp1 = compute_fingerprint("A@b.com", "Subject", None, "body text")
    fp2 = compute_fingerprint("a@b.com ", " subject ", None, "body text")
    assert fp1 == fp2  # normalization makes them equal

    messages, _ = parse_json_bytes(VALID_JSON)
    # Duplicate the second (no message_id) message within the batch.
    dup_batch = [messages[1], messages[1]]
    dups = find_duplicates(dup_batch, set(), set())
    assert len(dups) == 1
    assert dups[0].reason == "fingerprint"


def test_find_duplicates_message_id_against_existing():
    messages, _ = parse_json_bytes(VALID_JSON)
    existing_ids = {"<json-1@acme.com>"}
    dups = find_duplicates(messages, existing_ids, set())
    assert len(dups) == 1
    assert dups[0].reason == "message_id"
    assert dups[0].key == "<json-1@acme.com>"


# --------------------------------------------------------------------------- #
# Endpoint tests: preview
# --------------------------------------------------------------------------- #

def test_preview_valid_json():
    r = client.post(
        "/api/import/preview",
        files=_upload("emails.json", VALID_JSON, "application/json"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["format"] == "json"
    assert body["parsed_count"] == 2
    assert body["error_count"] == 0


def test_preview_valid_mbox():
    r = client.post(
        "/api/import/preview",
        files=_upload("mailbox.mbox", VALID_MBOX, "application/mbox"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["format"] == "mbox"
    assert body["parsed_count"] == 2


def test_preview_malformed_json_returns_422():
    r = client.post(
        "/api/import/preview",
        files=_upload("bad.json", b"{not json", "application/json"),
    )
    assert r.status_code == 422


def test_preview_bad_extension_returns_400():
    r = client.post(
        "/api/import/preview",
        files=_upload("notes.txt", b"hello", "text/plain"),
    )
    assert r.status_code == 400


def test_preview_empty_file_returns_400():
    r = client.post(
        "/api/import/preview",
        files=_upload("empty.json", b"", "application/json"),
    )
    assert r.status_code == 400


def test_preview_oversized_returns_413(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_bytes", 10, raising=False)
    big = json.dumps([{"subject": "x" * 100}]).encode()
    r = client.post(
        "/api/import/preview",
        files=_upload("big.json", big, "application/json"),
    )
    assert r.status_code == 413


def test_preview_missing_fields_counts_errors():
    data = json.dumps([{"source": "x"}, {"subject": "ok"}]).encode()
    r = client.post(
        "/api/import/preview",
        files=_upload("partial.json", data, "application/json"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["error_count"] == 1
    assert body["parsed_count"] == 1


# --------------------------------------------------------------------------- #
# Endpoint tests: commit (dedup + counts)
# --------------------------------------------------------------------------- #

def test_commit_imports_and_dedupes():
    msgs = [
        {
            "message_id": "<commit-unique-1@x.com>",
            "sender": "jobs@contoso.com",
            "subject": "Application received at Contoso",
            "date": "2026-10-20T09:00:00Z",
            "body": "thanks",
            "fingerprint": "",
        },
        {
            "message_id": "<commit-unique-1@x.com>",  # duplicate id within batch
            "sender": "jobs@contoso.com",
            "subject": "Application received at Contoso",
            "date": "2026-10-20T09:00:00Z",
            "body": "thanks again",
            "fingerprint": "",
        },
    ]
    r = client.post("/api/import/commit", json={"messages": msgs})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped"] == 1
    assert body["failed"] == 0

    # Re-committing the same message_id should now be skipped (vs stored).
    r2 = client.post("/api/import/commit", json={"messages": [msgs[0]]})
    assert r2.status_code == 200
    assert r2.json()["imported"] == 0
    assert r2.json()["skipped"] == 1


def test_commit_fingerprint_dedup_when_no_message_id():
    fp = compute_fingerprint(
        "hr@fingerprinted.com", "No ID here", None, "same body"
    )
    msg = {
        "message_id": None,
        "sender": "hr@fingerprinted.com",
        "subject": "No ID here",
        "date": None,
        "body": "same body",
        "fingerprint": fp,
    }
    r = client.post("/api/import/commit", json={"messages": [msg, msg]})
    assert r.status_code == 200
    body = r.json()
    assert body["imported"] == 1
    assert body["skipped"] == 1
