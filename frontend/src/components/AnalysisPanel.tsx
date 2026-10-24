import { ShieldCheck, ShieldAlert, Info } from "lucide-react";
import type { AnalysisResult } from "../types";
import { STATUS_LABELS } from "../types";
import { RiskWarningCard } from "./RiskWarningCard";

const RISK_LABELS: Record<string, string> = {
  low: "Low caution",
  medium: "Medium caution",
  high: "High caution",
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function AnalysisPanel({
  result,
  applicationId,
}: {
  result: AnalysisResult;
  applicationId?: string | null;
}) {
  const { extraction: ex, classification: cls, scam_warning: scam } = result;
  const statusLabel =
    STATUS_LABELS[cls.primary_status as keyof typeof STATUS_LABELS] ??
    cls.primary_status;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className={`analysis-trust ${result.verified ? "verified" : "unverified"}`}>
        {result.verified ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
        {result.verified ? (
          <span>Verified AI analysis{result.model ? ` · ${result.model}` : ""}</span>
        ) : (
          <span>Unverified · rule-based fallback (Gemini not connected)</span>
        )}
      </div>

      <div className="analysis-section">
        <h4>Classification</h4>
        <div className="inline" style={{ gap: 8 }}>
          <span className={`badge status-${cls.primary_status}`}>
            <span className="dot" aria-hidden="true" />
            {statusLabel}
          </span>
          <span className="muted small">
            confidence {(cls.confidence * 100).toFixed(0)}%
          </span>
        </div>
        {cls.explanation && (
          <p className="muted base" style={{ margin: "6px 0 0" }}>{cls.explanation}</p>
        )}
      </div>

      <div className="analysis-section">
        <h4>Extracted details</h4>
        <dl className="kv">
          <Row label="Company" value={ex.company_name} />
          <Row label="Job title" value={ex.job_title} />
          <Row label="Recruiter" value={ex.recruiter_name} />
          <Row label="Recruiter email" value={ex.recruiter_email} />
          <Row label="Date" value={ex.application_or_interview_date} />
          <Row label="Interview" value={ex.interview_or_assessment_details} />
          <Row label="Salary" value={ex.salary_information} />
          <Row label="Next action" value={ex.required_next_action} />
          <Row label="Follow-up" value={ex.recommended_follow_up_date} />
        </dl>
      </div>

      <div className="analysis-section">
        <h4>Risk check</h4>
        <div className="inline" style={{ gap: 8, marginBottom: 8 }}>
          <span className={`risk-chip risk-${scam.risk_level}`}>
            {RISK_LABELS[scam.risk_level] ?? scam.risk_level}
          </span>
          <span className="muted small">caution score {scam.risk_score}/100</span>
        </div>

        {scam.plain_explanation && (
          <p className="muted base" style={{ marginTop: 0 }}>{scam.plain_explanation}</p>
        )}

        {scam.deterministic_override && scam.conflict_explanation && (
          <div className="info-note warning conflict-note">{scam.conflict_explanation}</div>
        )}

        {scam.signals.length > 0 ? (
          <>
            <p className="warning-sub">Warning signals ({scam.signals.length})</p>
            <div className="warning-list">
              {scam.signals.map((s, i) => (
                <RiskWarningCard key={`${s.label}-${i}`} signal={s} applicationId={applicationId} />
              ))}
            </div>
          </>
        ) : (
          <p className="muted base" style={{ margin: 0 }}>
            No deterministic warning signals were detected.
          </p>
        )}

        {scam.counter_evidence.length > 0 && (
          <>
            <p className="warning-sub">Counter-evidence</p>
            <ul className="counter-list">
              {scam.counter_evidence.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </>
        )}

        {scam.recommendation && <p className="analysis-reco">{scam.recommendation}</p>}

        <p className="muted small analysis-disclaimer inline" style={{ gap: 6 }}>
          <Info size={13} />
          {scam.disclaimer ||
            "A caution assessment based on observable signals, not a verified fraud probability."}
        </p>
      </div>
    </div>
  );
}
