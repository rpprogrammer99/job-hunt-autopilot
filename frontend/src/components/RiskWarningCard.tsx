import { useState } from "react";
import { ChevronRight, ChevronDown, ThumbsUp, ThumbsDown } from "lucide-react";
import type { AnalysisRiskSignal } from "../types";
import { sendRiskFeedback } from "../services/analysisApi";

const CATEGORY_LABELS: Record<string, string> = {
  payment: "Payment / fees",
  credential_theft: "Credential request",
  domain_mismatch: "Sender / domain",
  suspicious_url: "Suspicious link",
  urgency: "Pressure / urgency",
  other: "Other",
};

interface Props {
  signal: AnalysisRiskSignal;
  applicationId?: string | null;
}

/**
 * One expandable warning. Collapsed by default; expands to show the plain-
 * English significance and the exact evidence from the email. Users can mark
 * the warning helpful or incorrect; the choice is recorded via the backend.
 */
export function RiskWarningCard({ signal, applicationId }: Props) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<"helpful" | "incorrect" | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(helpful: boolean) {
    setSaving(true);
    setErr(null);
    try {
      await sendRiskFeedback({
        application_id: applicationId ?? null,
        signal_label: signal.label,
        helpful,
      });
      setFeedback(helpful ? "helpful" : "incorrect");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="warning-card">
      <button
        className="warning-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="warning-caret" aria-hidden="true">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className={`warning-tag tag-${signal.category}`}>
          {CATEGORY_LABELS[signal.category] ?? signal.category}
        </span>
        <span className="warning-label">{signal.label}</span>
        {signal.source === "deterministic" && (
          <span className="warning-source" title="Detected by a transparent rule">
            rule
          </span>
        )}
      </button>

      {open && (
        <div className="warning-body">
          {signal.explanation && (
            <p className="warning-why">{signal.explanation}</p>
          )}
          {signal.evidence.length > 0 && (
            <>
              <p className="warning-sub">Evidence from the email</p>
              <ul className="evidence-list">
                {signal.evidence.map((e, i) => (
                  <li key={i}>“{e}”</li>
                ))}
              </ul>
            </>
          )}

          <div className="warning-feedback">
            {feedback ? (
              <span className="muted small">
                Thanks — marked {feedback}.
              </span>
            ) : (
              <>
                <span className="muted small">Was this warning useful?</span>
                <button
                  className="chip-btn"
                  disabled={saving}
                  onClick={() => void submit(true)}
                >
                  <ThumbsUp size={13} /> Helpful
                </button>
                <button
                  className="chip-btn"
                  disabled={saving}
                  onClick={() => void submit(false)}
                >
                  <ThumbsDown size={13} /> Incorrect
                </button>
              </>
            )}
            {err && <span className="error small">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
