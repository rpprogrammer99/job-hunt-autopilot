"""Tests for the seven-day follow-up reminder system.

Required scenarios:
  * Six days elapsed: not due.
  * Seven days elapsed: due.
  * Rejected application: no reminder.
  * Existing reminder: no duplicate.
  * Status changed to Interview: recalculate appropriately.

Plus: dismiss preservation and draft safety (no invented outcomes/dates).

Uses a FRESH InMemoryStore per test so the shared app singleton is not
polluted and assertions are deterministic.
"""
from datetime import datetime, timedelta, timezone

from app import reminder_service
from app.firestore_client import InMemoryStore
from app.models import Application, ApplicationStatus, ReminderStatus
from app.reminders import (
    REMINDER_THRESHOLD_DAYS,
    build_reminder_record,
    is_due,
    is_eligible,
)

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)


def _store() -> InMemoryStore:
    s = InMemoryStore()
    # Drop seeded demo apps so each test controls its own data.
    s._apps.clear()
    s._reminders.clear()
    return s


def _app(store: InMemoryStore, status, days_ago: int, **kw) -> Application:
    ts = NOW - timedelta(days=days_ago)
    app = Application(
        user_id="u1",
        company=kw.get("company", "Acme"),
        role=kw.get("role", "Engineer"),
        status=status,
        applied_at=ts,
        last_update_at=ts,
    )
    created = store.create_application(app)
    # create_application stamps last_update_at to "now"; restore our test date
    # so the elapsed-days math is controlled.
    raw = store._apps[created.id]
    raw["last_update_at"] = ts.isoformat()
    raw["applied_at"] = ts.isoformat()
    store._apps[created.id] = raw
    return store.get_application("u1", created.id)


# --------------------------------------------------------------------------- #
# Pure helpers
# --------------------------------------------------------------------------- #

def test_six_days_not_due():
    s = _store()
    app = _app(s, ApplicationStatus.APPLIED, days_ago=6)
    assert is_due(app, NOW) is False
    rec = build_reminder_record(app, NOW)
    assert rec is not None  # upcoming record exists
    assert rec.status is ReminderStatus.UPCOMING


def test_seven_days_due():
    s = _store()
    app = _app(s, ApplicationStatus.APPLIED, days_ago=REMINDER_THRESHOLD_DAYS)
    assert is_due(app, NOW) is True
    rec = build_reminder_record(app, NOW)
    assert rec.status in (ReminderStatus.DUE_TODAY, ReminderStatus.OVERDUE)


def test_rejected_not_eligible():
    s = _store()
    app = _app(s, ApplicationStatus.REJECTED, days_ago=30)
    assert is_eligible(app) is False
    assert build_reminder_record(app, NOW) is None


# --------------------------------------------------------------------------- #
# Service: recalculate / dedup / status change
# --------------------------------------------------------------------------- #

def test_rejected_application_no_reminder_created():
    s = _store()
    _app(s, ApplicationStatus.REJECTED, days_ago=20)
    res = reminder_service.recalculate(s, "u1", NOW)
    assert res.created == 0
    assert s.list_reminders("u1") == []


def test_due_application_creates_one_reminder():
    s = _store()
    _app(s, ApplicationStatus.APPLIED, days_ago=10)
    res = reminder_service.recalculate(s, "u1", NOW)
    assert res.created == 1
    assert len(s.list_reminders("u1")) == 1


def test_recalculate_twice_no_duplicate():
    s = _store()
    _app(s, ApplicationStatus.APPLIED, days_ago=10)
    reminder_service.recalculate(s, "u1", NOW)
    res2 = reminder_service.recalculate(s, "u1", NOW)
    # Second run refreshes the SAME cycle; it does not create a second record.
    assert res2.created == 0
    assert len(s.list_reminders("u1")) == 1


def test_status_change_to_interview_recalculates():
    s = _store()
    app = _app(s, ApplicationStatus.APPLIED, days_ago=10)
    reminder_service.recalculate(s, "u1", NOW)
    assert len(s.list_reminders("u1")) == 1

    # Change status to Interview (new cycle). Keep an old interaction date so
    # the new cycle is also due.
    s.update_application("u1", app.id, {"status": ApplicationStatus.INTERVIEW})
    raw = s._apps[app.id]
    raw["last_update_at"] = (NOW - timedelta(days=10)).isoformat()
    s._apps[app.id] = raw

    res = reminder_service.recalculate_for_application(s, "u1", NOW)
    # A new cycle reminder was created; the old one was obsoleted.
    assert res.created == 1
    assert res.obsoleted == 1
    active = [r for r in s.list_reminders("u1")
              if r.status not in (ReminderStatus.OBSOLETE, ReminderStatus.DISMISSED)]
    assert len(active) == 1
    assert active[0].cycle_key.split("|")[1] == "interview"


def test_dismiss_is_preserved_across_recalculation():
    s = _store()
    _app(s, ApplicationStatus.APPLIED, days_ago=10)
    reminder_service.recalculate(s, "u1", NOW)
    rid = s.list_reminders("u1")[0].id

    dismissed = reminder_service.dismiss(s, "u1", rid)
    assert dismissed.status is ReminderStatus.DISMISSED

    # Recalculating must NOT revive the dismissed reminder for the same cycle.
    reminder_service.recalculate(s, "u1", NOW)
    recs = s.list_reminders("u1")
    assert len(recs) == 1
    assert recs[0].status is ReminderStatus.DISMISSED


def test_group_buckets_overdue_due_today_upcoming():
    s = _store()
    _app(s, ApplicationStatus.APPLIED, days_ago=10, company="OverdueCo")   # overdue
    _app(s, ApplicationStatus.APPLIED, days_ago=7, company="DueTodayCo")   # due today
    _app(s, ApplicationStatus.APPLIED, days_ago=2, company="UpcomingCo")   # upcoming
    reminder_service.recalculate(s, "u1", NOW)
    grouped = reminder_service.group(s, "u1", NOW)
    assert [r.company for r in grouped.overdue] == ["OverdueCo"]
    assert [r.company for r in grouped.due_today] == ["DueTodayCo"]
    assert [r.company for r in grouped.upcoming] == ["UpcomingCo"]


# --------------------------------------------------------------------------- #
# Draft safety
# --------------------------------------------------------------------------- #

def test_draft_fallback_invents_nothing():
    app = Application(
        user_id="u1", company="Acme", role="Backend Engineer",
        status=ApplicationStatus.APPLIED,
    )
    draft = reminder_service.draft_followup(app)  # dev -> template fallback
    assert draft.source == "fallback-template"
    text = (draft.subject + " " + draft.body).lower()
    # Must not claim outcomes/promises.
    for forbidden in ("offer", "congratulations", "you have been selected",
                      "interview on", "scheduled for", "guarantee"):
        assert forbidden not in text
    assert "Backend Engineer" in draft.body
    assert "Acme" in draft.body
    assert "automatically" in draft.disclaimer.lower()
