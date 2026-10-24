"""The AI analysis agent.

Design:
  * An ADK ``LlmAgent`` is defined to document the agent (name, model,
    system instruction, and ``output_schema``). ADK is the orchestration
    framework; the agent object makes the configuration explicit and reusable.
  * The actual single-shot structured call is executed through the Google
    Gen AI SDK using the stable ``client.models.generate_content`` API with
    ``response_schema`` + ``response_mime_type="application/json"`` — the
    documented structured-output path available in the installed SDK.
  * Every model output is validated against the Pydantic schema before use.
  * When Gemini is unavailable or errors, a DETERMINISTIC rule-based fallback
    returns a result explicitly labeled ``verified=False`` /
    ``source="fallback-unverified"``. The fallback never fabricates AI
    findings; it reports only what simple rules can observe.

Security: email text is treated as untrusted data (see analysis_prompt). We
never execute content, open links, or send email. Bodies are not logged.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from .analysis_prompt import SYSTEM_INSTRUCTION, build_analysis_prompt
from .analysis_schema import (
    AnalysisResult,
    Classification,
    Extraction,
    ModelAnalysis,
    PrimaryStatus,
    RiskLevel,
    ScamWarning,
)
from .config import get_settings
from .models import EmailImport
from .risk_assessment import assess_risk

# --------------------------------------------------------------------------- #
# ADK agent definition (documents the agent configuration)
# --------------------------------------------------------------------------- #

def build_adk_agent():
    """Construct and return the ADK LlmAgent for email analysis.

    Returns None if ADK is not importable, so the rest of the app still works.
    The agent captures the system instruction, model, and output schema.
    """
    try:
        from google.adk.agents import LlmAgent  # verified import path

        settings = get_settings()
        return LlmAgent(
            name="job_hunt_email_analyst",
            model=settings.gemini_model,
            instruction=SYSTEM_INSTRUCTION,
            output_schema=ModelAnalysis,
        )
    except Exception:  # noqa: BLE001 - ADK optional at runtime
        return None


# --------------------------------------------------------------------------- #
# Gemini structured call (Gen AI SDK)
# --------------------------------------------------------------------------- #

def _gemini_analyze(email: EmailImport) -> Optional[ModelAnalysis]:
    """Call Gemini for a structured analysis. Returns a validated
    ``ModelAnalysis`` or None on any failure (so caller can fall back)."""
    settings = get_settings()
    if not settings.gemini_available:
        return None
    try:
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

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=build_analysis_prompt(email),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=ModelAnalysis,
                temperature=0.1,
            ),
        )
        return _validate_model_output(response)
    except Exception:  # noqa: BLE001 - any SDK/network error -> fallback
        return None


def _validate_model_output(response: object) -> Optional[ModelAnalysis]:
    """Validate the model response into a ModelAnalysis.

    Prefers the SDK's already-parsed object when present; otherwise parses the
    JSON text. Returns None if the output cannot be validated (invalid model
    output is never trusted).
    """
    # SDK may expose a parsed object when response_schema is a Pydantic model.
    parsed = getattr(response, "parsed", None)
    if isinstance(parsed, ModelAnalysis):
        return parsed
    if isinstance(parsed, dict):
        try:
            return ModelAnalysis.model_validate(parsed)
        except Exception:  # noqa: BLE001
            return None

    text = getattr(response, "text", None)
    if not text:
        return None
    # Extract the first JSON object if the text has surrounding noise.
    candidate = text.strip()
    if not candidate.startswith("{"):
        m = re.search(r"\{.*\}", candidate, re.DOTALL)
        if not m:
            return None
        candidate = m.group(0)
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    try:
        return ModelAnalysis.model_validate(data)
    except Exception:  # noqa: BLE001 - invalid model output
        return None


# --------------------------------------------------------------------------- #
# Deterministic, UNVERIFIED fallback
# --------------------------------------------------------------------------- #

_STATUS_KEYWORDS: list[tuple[PrimaryStatus, tuple[str, ...]]] = [
    (PrimaryStatus.REJECTED, (
        "unfortunately", "not moving forward", "other candidates",
        "will not be proceeding", "regret to inform", "decided not to",
    )),
    (PrimaryStatus.OFFER, (
        "offer letter", "pleased to offer", "we would like to offer",
        "extend an offer", "job offer",
    )),
    (PrimaryStatus.ASSESSMENT, (
        "assessment", "coding challenge", "take-home", "take home",
        "online test", "hackerrank", "codility",
    )),
    (PrimaryStatus.INTERVIEW, (
        "interview", "schedule a call", "availability", "technical screen",
        "meet with the team", "phone screen",
    )),
    (PrimaryStatus.APPLIED, (
        "received your application", "thank you for applying",
        "application has been received", "reviewing your application",
    )),
]

# Rule-based scam signals. Each entry: (regex, signal label).
_SCAM_PATTERNS: list[tuple[str, str]] = [
    (r"\bgift cards?\b", "Requests payment via gift cards"),
    (r"\b(onboarding|processing|registration|training)\s+fee\b",
     "Asks for an upfront fee"),
    (r"\bwire\s+(?:money|transfer|\$?\d)", "Requests a wire transfer"),
    (r"\b(password|otp|one[- ]time passcode|pin)\b",
     "Requests password/OTP/PIN"),
    (r"bank account|routing number|account number",
     "Requests banking credentials"),
    (r"\bssn\b|social security", "Requests Social Security Number"),
    (r"no interview required|without an interview|no interview needed",
     "Guaranteed job without an interview"),
    (r"act now|urgent|expires in \d+\s*(hour|minute)|immediately",
     "Pressure/urgency tactics"),
    (r"\$\s?\d{3,}\s?/\s?(week|day)", "Unrealistic pay for little work"),
    (r"\.(zip|exe|scr|js)\b", "Suspicious attachment type referenced"),
]

_LOOKALIKE_HINTS = ("g00gle", "-secure.", "careers-secure", "verify-", ".xyz")


def _detect_status(text: str) -> tuple[PrimaryStatus, float]:
    lowered = text.lower()
    # Remove phrases that would cause false keyword matches (e.g. a scam line
    # "no interview required" should NOT be read as an interview invitation).
    for negation in ("no interview required", "without an interview",
                     "no interview needed"):
        lowered = lowered.replace(negation, " ")
    for status, keywords in _STATUS_KEYWORDS:
        for kw in keywords:
            if kw in lowered:
                return status, 0.5
    return PrimaryStatus.APPLIED, 0.3


def _rule_scam(email: EmailImport) -> ScamWarning:
    text = f"{email.subject}\n{email.body}"
    lowered = text.lower()
    signals: list[str] = []
    evidence: list[str] = []

    for pattern, label in _SCAM_PATTERNS:
        m = re.search(pattern, lowered)
        if m and label not in signals:
            signals.append(label)
            # Evidence is a short reference, never the whole body.
            start = max(m.start() - 20, 0)
            end = min(m.end() + 20, len(text))
            evidence.append(text[start:end].strip()[:80])

    domain_match = re.search(r"@([\w.\-]+)", email.from_ or "")
    domain = domain_match.group(1).lower() if domain_match else ""
    if any(h in domain for h in _LOOKALIKE_HINTS):
        signals.append("Sender domain looks untrustworthy")
        evidence.append(f"sender domain: {domain}"[:80])

    score = min(len(signals) * 25, 100)
    if score >= 60:
        level = RiskLevel.HIGH
    elif score >= 25:
        level = RiskLevel.MEDIUM
    else:
        level = RiskLevel.LOW

    recommendation = (
        "Treat as potentially unsafe: do not pay, share credentials, or send "
        "documents. Verify the company via an official channel."
        if signals
        else "No obvious warning signs detected by rules. Still verify the "
        "sender independently before sharing personal information."
    )
    return ScamWarning(
        risk_level=level,
        risk_score=score,
        risk_signals=signals,
        evidence=evidence,
        recommendation=recommendation,
    )


def _fallback_analyze(email: EmailImport, reason: str) -> AnalysisResult:
    """Deterministic analysis used when Gemini is unavailable/failed.

    Explicitly labeled unverified. Extraction is intentionally minimal — only
    what trivial rules can observe — and never fabricated.
    """
    status, confidence = _detect_status(f"{email.subject}\n{email.body}")
    domain_match = re.search(r"@([\w.\-]+)", email.from_ or "")
    extraction = Extraction(
        recruiter_email=email.from_ or None,
        application_or_interview_date=(
            email.received_at.isoformat() if email.received_at else None
        ),
        company_name=(
            domain_match.group(1).split(".")[0].capitalize()
            if domain_match
            else None
        ),
    )
    classification = Classification(
        primary_status=status,
        confidence=confidence,
        explanation=(
            "Unverified rule-based classification from keyword matching; "
            "Gemini was not used."
        ),
    )
    return AnalysisResult(
        extraction=extraction,
        classification=classification,
        scam_warning=assess_risk(email, claimed_company=extraction.company_name),
        verified=False,
        source="fallback-unverified",
        model=None,
        notes=f"Fallback used: {reason}. Results are unverified.",
    )


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #

def analyze_email(email: EmailImport) -> AnalysisResult:
    """Analyze one email, preferring Gemini and falling back deterministically.

    The returned result always carries honest provenance metadata so callers
    and the UI can distinguish verified AI analysis from the unverified
    fallback.
    """
    settings = get_settings()

    if not settings.gemini_available:
        return _fallback_analyze(email, reason="Gemini not configured")

    model_output = _gemini_analyze(email)
    if model_output is None:
        return _fallback_analyze(
            email, reason="Gemini call failed or returned invalid output"
        )

    return AnalysisResult(
        extraction=model_output.extraction,
        classification=model_output.classification,
        # The dedicated risk module governs the scam warning so the transparent
        # deterministic checks (and the credential/payment floor) always apply,
        # even when Gemini produced the extraction/classification.
        scam_warning=assess_risk(
            email, claimed_company=model_output.extraction.company_name
        ),
        verified=True,
        source="gemini",
        model=settings.gemini_model,
        notes="",
    )
