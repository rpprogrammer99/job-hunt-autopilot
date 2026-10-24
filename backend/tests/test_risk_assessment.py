"""Tests for the dedicated risk_assessment module.

Covers: safe, ambiguous, and high-risk examples; the rule that Gemini may not
downgrade a clear credential-theft / upfront-payment signal (with an explained
conflict); and that unfamiliarity / poor grammar / generic greeting alone are
NOT treated as fraud signals. Also exercises the /api/risk-feedback endpoint.
"""
import pytest
from fastapi.testclient import TestClient

from app.analysis_schema import ModelRiskExplanation, RiskCategory, RiskLevel
from app.main import app
from app.models import EmailImport
from app.risk_assessment import (
    assess_deterministic,
    assess_risk,
    combine,
    deterministic_floor,
    deterministic_signals,
)

client = TestClient(app)


def _email(**kw) -> EmailImport:
    return EmailImport.model_validate(kw)


# --------------------------------------------------------------------------- #
# Safe
# --------------------------------------------------------------------------- #

def test_safe_email_is_low_risk_no_signals():
    email = _email(
        **{"from": "careers@acmecloud.com"},
        subject="Thank you for applying to Acme Cloud",
        body="We received your application for the Software Engineer role and "
        "our team is reviewing it. We will be in touch about next steps.",
    )
    result = assess_deterministic(email)
    assert result.risk_level is RiskLevel.LOW
    assert result.risk_score == 0
    assert result.signals == []
    # Disclaimer always present; score is NOT framed as fraud probability.
    assert "not a verified fraud probability" in result.disclaimer.lower()


def test_unfamiliar_sender_and_generic_greeting_are_not_signals():
    # Unknown company + generic greeting + a small grammar slip -> still LOW.
    email = _email(
        **{"from": "hr@some-unknown-startup.io"},
        subject="Dear Candidate",
        body="Hello, we is reviewing you application. Thanks you for interest.",
    )
    result = assess_risk(email)
    assert result.risk_level is RiskLevel.LOW
    assert result.signals == []


# --------------------------------------------------------------------------- #
# Ambiguous
# --------------------------------------------------------------------------- #

def test_ambiguous_email_has_signal_but_not_high():
    # A single shortener link + mild urgency: worth caution, not high risk.
    email = _email(
        **{"from": "recruiter@talentfirm.com"},
        subject="Opportunity - please respond soon",
        body="We think you're a fit. Review the role here: https://bit.ly/abc "
        "and reply at your earliest convenience.",
    )
    result = assess_risk(email)
    assert result.risk_level in (RiskLevel.LOW, RiskLevel.MEDIUM)
    assert result.risk_level is not RiskLevel.HIGH
    # No hard floor because there is no credential/payment signal.
    assert deterministic_floor(deterministic_signals(email)) is None


# --------------------------------------------------------------------------- #
# High risk
# --------------------------------------------------------------------------- #

def test_high_risk_payment_and_credentials():
    email = _email(
        **{"from": "hr@g00gle-careers-secure.xyz"},
        subject="You are hired! Pay onboarding fee",
        body="Congratulations! Pay a $250 onboarding fee via gift cards and "
        "send your bank account number and OTP. Act now, expires in 2 hours!",
    )
    result = assess_risk(email)
    assert result.risk_level is RiskLevel.HIGH
    cats = {s.category for s in result.signals}
    assert RiskCategory.PAYMENT in cats
    assert RiskCategory.CREDENTIAL_THEFT in cats
    assert RiskCategory.URGENCY in cats
    # Evidence is present and bounded (not the entire body).
    assert all(len(e) <= 120 for s in result.signals for e in s.evidence)


def test_url_signal_does_not_visit_links():
    # The evidence should reference the link text only; nothing is fetched.
    email = _email(
        subject="verify",
        body="Confirm here: http://192.168.0.1/login and http://bit.ly/x",
    )
    sigs = [s for s in deterministic_signals(email)
            if s.category is RiskCategory.SUSPICIOUS_URL]
    assert sigs
    for s in sigs:
        assert "not opened" in s.explanation.lower()


# --------------------------------------------------------------------------- #
# Gemini may not downgrade clear credential/payment signals
# --------------------------------------------------------------------------- #

def test_gemini_cannot_downgrade_hard_signals():
    email = _email(
        **{"from": "hr@company.com"},
        subject="Welcome aboard",
        body="Please pay a $100 onboarding fee to secure your position and "
        "share your bank account number to set up payroll.",
    )
    signals = deterministic_signals(email)
    base = assess_deterministic(email)
    # The model tries to call it LOW.
    model = ModelRiskExplanation(
        suggested_risk_level=RiskLevel.LOW,
        plain_explanation="Seems like a normal onboarding email.",
        counter_evidence=["Uses a plausible company domain"],
        uncertainty="",
        recommendation="Proceed",
    )
    out = combine(base, signals, model)
    assert out.risk_level is RiskLevel.HIGH  # two hard signals -> HIGH floor
    assert out.deterministic_override is True
    assert out.conflict_explanation  # conflict is explained
    # Model's counter-evidence is still surfaced (not hidden).
    assert out.counter_evidence == ["Uses a plausible company domain"]


def test_gemini_may_raise_but_not_silently_lower_single_hard_signal():
    email = _email(subject="Account", body="Send your password to continue.")
    signals = deterministic_signals(email)
    base = assess_deterministic(email)
    # Single credential signal -> floor MEDIUM. Model says LOW -> kept at MEDIUM.
    model = ModelRiskExplanation(suggested_risk_level=RiskLevel.LOW)
    out = combine(base, signals, model)
    assert out.risk_level is RiskLevel.MEDIUM
    assert out.deterministic_override is True


def test_combine_without_hard_signal_respects_model_level():
    email = _email(subject="hi", body="Review the role at https://bit.ly/x")
    signals = deterministic_signals(email)
    base = assess_deterministic(email)
    # No hard signal -> model may raise to MEDIUM; nothing is overridden.
    model = ModelRiskExplanation(suggested_risk_level=RiskLevel.MEDIUM)
    out = combine(base, signals, model)
    assert out.risk_level is RiskLevel.MEDIUM
    assert out.deterministic_override is False


# --------------------------------------------------------------------------- #
# Endpoint: feedback
# --------------------------------------------------------------------------- #

def test_risk_feedback_endpoint_records():
    r = client.post(
        "/api/risk-feedback",
        json={"signal_label": "Requests an OTP", "helpful": True,
              "comment": "good catch"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["recorded"] is True
    assert body["total_feedback"] >= 1


def test_analyze_endpoint_exposes_structured_signals_and_disclaimer():
    r = client.post(
        "/api/analyze",
        json={
            "from": "hr@g00gle-careers-secure.xyz",
            "subject": "You are hired! Pay onboarding fee",
            "body": "Pay a $250 onboarding fee via gift cards and send your OTP.",
        },
    )
    assert r.status_code == 200
    scam = r.json()["scam_warning"]
    assert scam["risk_level"] in {"medium", "high"}
    assert len(scam["signals"]) >= 1
    assert "category" in scam["signals"][0]
    assert "not a verified fraud probability" in scam["disclaimer"].lower()
