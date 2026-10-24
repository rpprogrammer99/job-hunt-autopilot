"""Unit tests for the Job Hunt Autopilot agent and reminder logic.

These exercise the deterministic rule-based engine (no network / no cloud),
which is also the guaranteed fallback path in production code.
"""
from datetime import datetime, timedelta, timezone

from app.agent import detect_suspicious, parse_email, rule_based_parse
from app.models import Application, ApplicationStatus, EmailImport
from app.reminders import (
    REMINDER_THRESHOLD_DAYS,
    build_reminders,
    days_since_update,
    needs_reminder,
)


def _email(**kw) -> EmailImport:
    return EmailImport.model_validate(kw)


# ------------------------------ Parsing ----------------------------------- #

def test_parse_applied_email():
    email = _email(
        **{"from": "careers@acmecloud.com"},
        subject="Thank you for applying to Acme Cloud - Software Engineer",
        body="We have received your application and are reviewing it.",
    )
    parsed = rule_based_parse(email)
    assert parsed.status == ApplicationStatus.APPLIED
    assert "Acme" in parsed.company
    assert parsed.suspicious is False


def test_parse_interview_email():
    email = _email(
        **{"from": "no-reply@brightwave.io"},
        subject="Interview Invitation: Frontend Developer at Brightwave",
        body="We would like to invite you to a technical interview. Send availability.",
    )
    parsed = rule_based_parse(email)
    assert parsed.status == ApplicationStatus.INTERVIEW
    assert "Brightwave" in parsed.company
    assert "Frontend Developer" in parsed.role


def test_parse_rejected_email():
    email = _email(
        **{"from": "recruiting@novadata.com"},
        subject="Application update - Data Analyst role",
        body="We have decided to move forward with other candidates at this time.",
    )
    parsed = rule_based_parse(email)
    assert parsed.status == ApplicationStatus.REJECTED


# ------------------------- Suspicious detection --------------------------- #

def test_detect_suspicious_scam_email():
    email = _email(
        **{"from": "hr-dept@g00gle-careers-secure.xyz"},
        subject="URGENT: You are hired! Pay onboarding fee to start",
        body=(
            "No interview required. Pay a $250 onboarding fee via gift cards "
            "and send your SSN and bank account. Offer expires in 2 hours!"
        ),
    )
    suspicious, reasons = detect_suspicious(email)
    assert suspicious is True
    assert len(reasons) >= 3
    parsed = parse_email(email)
    assert parsed.suspicious is True
    assert parsed.status == ApplicationStatus.SUSPICIOUS


def test_legit_email_not_suspicious():
    email = _email(
        **{"from": "talent@finchpay.com"},
        subject="We received your application - Backend Engineer",
        body="This confirms your application for the Backend Engineer role.",
    )
    suspicious, reasons = detect_suspicious(email)
    assert suspicious is False
    assert reasons == []


# ------------------------------ Reminders --------------------------------- #

def _app(status, days_ago, suspicious=False) -> Application:
    ts = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return Application(
        id="x",
        user_id="dev-user",
        company="Acme",
        role="SWE",
        status=status,
        applied_at=ts,
        last_update_at=ts,
        suspicious=suspicious,
    )


def test_needs_reminder_after_threshold():
    app = _app(ApplicationStatus.APPLIED, days_ago=REMINDER_THRESHOLD_DAYS + 1)
    assert days_since_update(app) >= REMINDER_THRESHOLD_DAYS
    assert needs_reminder(app) is True


def test_no_reminder_before_threshold():
    app = _app(ApplicationStatus.APPLIED, days_ago=2)
    assert needs_reminder(app) is False


def test_no_reminder_for_rejected():
    app = _app(ApplicationStatus.REJECTED, days_ago=30)
    assert needs_reminder(app) is False


def test_no_reminder_for_suspicious():
    app = _app(ApplicationStatus.APPLIED, days_ago=30, suspicious=True)
    assert needs_reminder(app) is False


def test_build_reminders_filters_correctly():
    apps = [
        _app(ApplicationStatus.APPLIED, days_ago=10),
        _app(ApplicationStatus.INTERVIEW, days_ago=8),
        _app(ApplicationStatus.APPLIED, days_ago=1),
        _app(ApplicationStatus.REJECTED, days_ago=20),
    ]
    reminders = build_reminders(apps)
    assert len(reminders) == 2
    for r in reminders:
        assert r.days_since_update >= REMINDER_THRESHOLD_DAYS
