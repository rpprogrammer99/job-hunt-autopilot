"""The Job Hunt Autopilot agent.

Responsibilities:
  1. Parse a recruiting email into structured fields (company, role, status).
  2. Detect potentially suspicious / scam recruiting emails.

Design:
  - When Gemini is configured (via Google Gen AI SDK, optionally through
    Vertex AI, and orchestrated with Google ADK), we ask the model to return
    structured JSON.
  - When no key/credentials are available, a deterministic rule-based engine
    produces the same structure. This keeps the app fully functional offline
    and makes the logic unit-testable without any network calls.

The rule-based functions are intentionally pure and importable so tests can
exercise parsing, suspicious detection, and reminders directly.
"""
from __future__ import annotations

import json
import re
from typing import Optional

from .config import get_settings
from .models import ApplicationStatus, EmailImport, ParsedEmail

# --------------------------------------------------------------------------- #
# Rule-based heuristics (deterministic fallback + test target)
# --------------------------------------------------------------------------- #

_STATUS_KEYWORDS: dict[ApplicationStatus, tuple[str, ...]] = {
    ApplicationStatus.REJECTED: (
        "unfortunately",
        "not moving forward",
        "other candidates",
        "will not be proceeding",
        "regret to inform",
        "decided to move forward with other",
    ),
    ApplicationStatus.OFFER: (
        "offer letter",
        "pleased to offer",
        "we would like to offer",
        "extend an offer",
    ),
    ApplicationStatus.INTERVIEW: (
        "interview",
        "schedule a call",
        "availability",
        "technical screen",
        "meet with the team",
    ),
    ApplicationStatus.APPLIED: (
        "received your application",
        "thank you for applying",
        "application has been received",
        "reviewing it",
    ),
}

# Signals of a suspicious / scam recruiting email.
_SUSPICIOUS_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\bgift cards?\b", "Requests payment via gift cards"),
    (r"\bonboarding fee\b", "Asks for an upfront onboarding/processing fee"),
    (r"\bprocessing fee\b", "Asks for an upfront onboarding/processing fee"),
    (r"\bssn\b|social security", "Requests Social Security Number"),
    (r"bank account|routing number", "Requests bank account details early"),
    (r"no interview required|without an interview", "Hiring without any interview"),
    (r"act now|expires in \d+ (hour|minute)", "Creates artificial urgency"),
    (r"\$\s?\d{3,}\s?/\s?(week|day)", "Unrealistic pay for little work"),
    (r"you (are|have been) (hired|selected)", "Unsolicited guaranteed hire"),
)

# Domains that look like lookalike / typosquat recruiter domains.
_SUSPICIOUS_DOMAIN_HINTS: tuple[str, ...] = (
    "g00gle",
    "-secure.",
    ".xyz",
    "careers-secure",
    "verify-",
)


def _domain_of(sender: str) -> str:
    match = re.search(r"@([\w.\-]+)", sender or "")
    return match.group(1).lower() if match else ""


def detect_suspicious(email: EmailImport) -> tuple[bool, list[str]]:
    """Return (is_suspicious, reasons) using deterministic heuristics."""
    text = f"{email.subject}\n{email.body}".lower()
    reasons: list[str] = []

    for pattern, reason in _SUSPICIOUS_PATTERNS:
        if re.search(pattern, text) and reason not in reasons:
            reasons.append(reason)

    domain = _domain_of(email.from_)
    for hint in _SUSPICIOUS_DOMAIN_HINTS:
        if hint in domain:
            reasons.append(f"Sender domain looks untrustworthy: {domain}")
            break

    return (len(reasons) > 0, reasons)


def _detect_status(text: str) -> ApplicationStatus:
    lowered = text.lower()
    # Order matters: rejection/offer are more specific than interview/applied.
    for status in (
        ApplicationStatus.REJECTED,
        ApplicationStatus.OFFER,
        ApplicationStatus.INTERVIEW,
        ApplicationStatus.APPLIED,
    ):
        for kw in _STATUS_KEYWORDS[status]:
            if kw in lowered:
                return status
    return ApplicationStatus.APPLIED


def _extract_company(email: EmailImport) -> str:
    # Prefer "at <Company>" in the subject.
    m = re.search(r"\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})", email.subject)
    if m:
        return m.group(1).strip().rstrip(".")
    # Fall back to a title-cased domain root.
    domain = _domain_of(email.from_)
    if domain:
        root = domain.split(".")[0]
        root = re.sub(r"[^a-z0-9]", "", root)
        if root and root not in ("no", "noreply", "careers", "hr", "talent"):
            return root.capitalize()
        # Try second label (e.g. careers@acmecloud.com -> acmecloud)
        parts = domain.split(".")
        if len(parts) >= 2:
            return parts[-2].capitalize()
    return "Unknown"


def _extract_role(email: EmailImport) -> str:
    patterns = [
        r"(?:for the|for a|the)\s+([A-Z][A-Za-z/ ]+?)\s+(?:position|role|at)\b",
        r"\b([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3})\s+(?:position|role)\b",
        r":\s*([A-Z][A-Za-z/ ]+?)\s+(?:at|-)\b",
    ]
    hay = f"{email.subject}. {email.body}"
    for pat in patterns:
        m = re.search(pat, hay)
        if m:
            role = m.group(1).strip()
            if 2 <= len(role) <= 50:
                return role
    return "Unknown"


def rule_based_parse(email: EmailImport) -> ParsedEmail:
    """Pure, deterministic email parse used as the offline fallback."""
    suspicious, reasons = detect_suspicious(email)
    status = (
        ApplicationStatus.SUSPICIOUS
        if suspicious
        else _detect_status(f"{email.subject}\n{email.body}")
    )
    return ParsedEmail(
        company=_extract_company(email),
        role=_extract_role(email),
        status=status,
        suspicious=suspicious,
        suspicious_reasons=reasons,
        confidence=0.6,
        summary=(email.subject or "").strip()[:140],
    )


# --------------------------------------------------------------------------- #
# Gemini via Google Gen AI SDK + ADK
# --------------------------------------------------------------------------- #

_PARSE_INSTRUCTION = (
    "You are a job-application email analyst. Given a recruiting email, return "
    "ONLY compact JSON with keys: company (string), role (string), status "
    "(one of applied, interview, offer, rejected, suspicious), suspicious "
    "(boolean), suspicious_reasons (array of short strings), confidence "
    "(0..1 float), summary (<=140 chars). Flag suspicious when the email asks "
    "for money/fees, gift cards, SSN or bank details, promises a job without "
    "an interview, uses high-pressure urgency, or comes from a lookalike "
    "domain."
)


def _parse_json_block(text: str) -> Optional[dict]:
    """Extract the first JSON object from a model response."""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        candidate = brace.group(0) if brace else None
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _gemini_parse(email: EmailImport) -> Optional[ParsedEmail]:
    """Call Gemini through the Google Gen AI SDK. Returns None on any failure
    so the caller can fall back to rules."""
    settings = get_settings()
    if not settings.gemini_available:
        return None
    try:
        from google import genai  # google-genai SDK
        from google.genai import types

        if settings.google_genai_use_vertexai:
            client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        else:
            client = genai.Client(api_key=settings.google_api_key)

        prompt = (
            f"{_PARSE_INSTRUCTION}\n\n"
            f"FROM: {email.from_}\n"
            f"SUBJECT: {email.subject}\n"
            f"BODY:\n{email.body}\n"
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )
        data = _parse_json_block(getattr(response, "text", "") or "")
        if not data:
            return None
        return ParsedEmail(
            company=str(data.get("company", "Unknown")) or "Unknown",
            role=str(data.get("role", "Unknown")) or "Unknown",
            status=ApplicationStatus(
                str(data.get("status", "applied")).lower()
                if str(data.get("status", "applied")).lower()
                in {s.value for s in ApplicationStatus}
                else "applied"
            ),
            suspicious=bool(data.get("suspicious", False)),
            suspicious_reasons=[str(r) for r in data.get("suspicious_reasons", [])],
            confidence=float(data.get("confidence", 0.7)),
            summary=str(data.get("summary", ""))[:140],
        )
    except Exception:  # noqa: BLE001 - any SDK/network error -> fallback
        return None


def parse_email(email: EmailImport) -> ParsedEmail:
    """Parse an email, preferring Gemini and falling back to rules.

    The rule-based suspicious detector always runs and is merged in, so that
    obvious scam signals are never missed even if the model under-flags.
    """
    parsed = _gemini_parse(email) or rule_based_parse(email)

    # Safety net: union the rule-based suspicious signals.
    rule_suspicious, rule_reasons = detect_suspicious(email)
    if rule_suspicious:
        parsed.suspicious = True
        merged = list(dict.fromkeys([*parsed.suspicious_reasons, *rule_reasons]))
        parsed.suspicious_reasons = merged
        parsed.status = ApplicationStatus.SUSPICIOUS
    return parsed
