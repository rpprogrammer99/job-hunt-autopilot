"""Pydantic schemas for the AI analysis agent's structured output.

These models double as the `response_schema` passed to the Gen AI SDK (so the
model is constrained to emit matching JSON) and as the validation layer applied
to any model output before it is saved. Kept separate from route handlers.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class PrimaryStatus(str, Enum):
    """Exactly one primary status is assigned to each email."""

    APPLIED = "applied"
    ASSESSMENT = "assessment"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Extraction(BaseModel):
    """Facts pulled from the email. Fields are optional because the email may
    not contain them — the agent must NOT invent missing values."""

    company_name: Optional[str] = Field(
        default=None, description="Hiring company name, if stated."
    )
    job_title: Optional[str] = Field(
        default=None, description="Role / job title, if stated."
    )
    recruiter_name: Optional[str] = Field(
        default=None, description="Recruiter or contact person name, if present."
    )
    recruiter_email: Optional[str] = Field(
        default=None, description="Recruiter email address, if present."
    )
    application_or_interview_date: Optional[str] = Field(
        default=None,
        description="Relevant application/interview date mentioned (as written).",
    )
    interview_or_assessment_details: Optional[str] = Field(
        default=None,
        description="Details about an interview or assessment, if any.",
    )
    salary_information: Optional[str] = Field(
        default=None,
        description="Salary/compensation ONLY if explicitly stated.",
    )
    required_next_action: Optional[str] = Field(
        default=None,
        description="What the recipient is asked or expected to do next.",
    )
    recommended_follow_up_date: Optional[str] = Field(
        default=None,
        description="A suggested follow-up date when applicable (ISO date).",
    )


class Classification(BaseModel):
    primary_status: PrimaryStatus = Field(
        description="Exactly one primary status based on the email evidence."
    )
    confidence: float = Field(
        ge=0.0, le=1.0, description="Confidence in the status (0..1)."
    )
    explanation: str = Field(
        default="",
        description="Short explanation grounded in the email evidence.",
    )


class RiskCategory(str, Enum):
    """Categories of deterministic risk checks."""

    PAYMENT = "payment"  # upfront fees / payment to secure a job
    CREDENTIAL_THEFT = "credential_theft"  # passwords, OTPs, bank credentials
    DOMAIN_MISMATCH = "domain_mismatch"  # org vs sender-domain mismatch
    SUSPICIOUS_URL = "suspicious_url"  # risky URL patterns (never visited)
    URGENCY = "urgency"  # urgency / coercion language
    OTHER = "other"


class RiskSignal(BaseModel):
    """A single, transparent warning signal.

    Deterministic signals carry hard evidence extracted from the text. The
    `source` field makes it explicit whether a rule or the model produced it.
    """

    category: RiskCategory = Field(description="The kind of signal.")
    label: str = Field(description="Short human-readable signal name.")
    explanation: str = Field(
        default="",
        description="Why this signal matters (significance), in plain terms.",
    )
    evidence: list[str] = Field(
        default_factory=list,
        description="Brief quotes/references from the email supporting it.",
    )
    source: str = Field(
        default="deterministic",
        description="'deterministic' (rule) or 'gemini' (model).",
    )


class ScamWarning(BaseModel):
    risk_level: RiskLevel = Field(description="low, medium, or high.")
    risk_score: int = Field(
        ge=0,
        le=100,
        description="Caution score 0-100. NOT a verified fraud probability.",
    )
    # Structured signals (preferred). Each carries category + evidence.
    signals: list[RiskSignal] = Field(
        default_factory=list,
        description="Structured warning signals (empty if none).",
    )
    # Legacy flat list kept for backward compatibility with existing clients.
    risk_signals: list[str] = Field(
        default_factory=list,
        description="Flat list of signal labels (mirrors `signals`).",
    )
    evidence: list[str] = Field(
        default_factory=list,
        description="Brief quotations/references to relevant email content.",
    )
    plain_explanation: str = Field(
        default="",
        description="A brief plain-English explanation of the assessment.",
    )
    counter_evidence: list[str] = Field(
        default_factory=list,
        description="Observations that reduce suspicion / argue it is legitimate.",
    )
    uncertainty: str = Field(
        default="",
        description="What is uncertain or could not be determined.",
    )
    recommendation: str = Field(
        default="",
        description="A safe next step for the recipient.",
    )
    disclaimer: str = Field(
        default=(
            "This is a caution assessment based on observable signals, not a "
            "verified fraud probability. A warning is not proof of fraud."
        ),
        description="Always-present caveat shown to users.",
    )
    # True when the deterministic floor overrode a lower model risk level.
    deterministic_override: bool = Field(
        default=False,
        description="True if a clear credential/payment signal set the floor.",
    )
    conflict_explanation: str = Field(
        default="",
        description="If the model disagreed with a hard signal, why we kept it.",
    )


class AnalysisResult(BaseModel):
    """The full structured analysis for one email."""

    extraction: Extraction
    classification: Classification
    scam_warning: ScamWarning

    # Provenance / trust metadata (set by the server, not the model).
    verified: bool = Field(
        default=True,
        description="True if produced by the Gemini model; False for the "
        "deterministic fallback.",
    )
    source: str = Field(
        default="gemini",
        description="'gemini' or 'fallback-unverified'.",
    )
    model: Optional[str] = Field(
        default=None, description="Model id used, when applicable."
    )
    notes: str = Field(
        default="",
        description="Analyzer notes (e.g. why the fallback was used).",
    )


# The schema the model must emit. Trust metadata is excluded from what the
# model controls; the server stamps it after validation.
class ModelAnalysis(BaseModel):
    extraction: Extraction
    classification: Classification
    scam_warning: ScamWarning


# --------------------------------------------------------------------------- #
# Risk-specific model output + user feedback
# --------------------------------------------------------------------------- #

class ModelRiskExplanation(BaseModel):
    """What Gemini is asked to return for the risk-explanation step ONLY.

    Gemini explains significance and surfaces counter-evidence/uncertainty. It
    proposes a risk level, but the combiner enforces a deterministic floor for
    clear credential-theft / upfront-payment signals.
    """

    suggested_risk_level: RiskLevel = Field(
        description="Model's suggested overall risk level."
    )
    signal_explanations: list[str] = Field(
        default_factory=list,
        description="Plain-English significance of the provided signals.",
    )
    counter_evidence: list[str] = Field(
        default_factory=list,
        description="Observations that argue the email may be legitimate.",
    )
    uncertainty: str = Field(
        default="",
        description="What remains uncertain from the evidence.",
    )
    plain_explanation: str = Field(
        default="",
        description="A brief overall explanation in plain English.",
    )
    recommendation: str = Field(
        default="",
        description="A safe next step for the recipient.",
    )


class RiskFeedback(BaseModel):
    """User feedback on a specific warning signal or the overall assessment."""

    application_id: Optional[str] = Field(
        default=None, description="Application the warning relates to, if any."
    )
    signal_label: Optional[str] = Field(
        default=None,
        description="Specific signal the feedback is about; null = overall.",
    )
    helpful: bool = Field(description="True = helpful, False = incorrect.")
    comment: str = Field(default="", description="Optional free-text comment.")


class RiskFeedbackAck(BaseModel):
    recorded: bool = True
    total_feedback: int = 0
