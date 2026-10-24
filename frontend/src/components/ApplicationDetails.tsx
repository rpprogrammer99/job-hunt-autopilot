import { useEffect, useState } from "react";
import { X, Sparkles, Building2 } from "lucide-react";
import type { AnalysisResult, Application, ApplicationStatus } from "../types";
import { APPLICATION_STATUSES, STATUS_LABELS } from "../types";
import { formatDate } from "../lib/helpers";
import { analyzeApplication } from "../services/analysisApi";
import {
  IconButton,
  Button,
  Select,
  StatusBadge,
  SourceBadge,
  Spinner,
  ErrorBanner,
} from "./ui";
import { AnalysisPanel } from "./AnalysisPanel";

interface Props {
  application: Application | null;
  onClose: () => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}

export function ApplicationDetails({ application, onClose, onStatusChange }: Props) {
  const open = application !== null;
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset analysis + close on Escape when drawer changes.
  useEffect(() => {
    setAnalysis(null);
    setAnalyzing(false);
    setError(null);
  }, [application?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function runAnalysis() {
    if (!application) return;
    setAnalyzing(true);
    setError(null);
    try {
      setAnalysis(await analyzeApplication(application));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <div className={`drawer-scrim ${open ? "show" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`drawer ${open ? "open" : ""}`}
        aria-hidden={!open}
        role="dialog"
        aria-label={application ? `${application.company} details` : "Application details"}
      >
        {application && (
          <>
            <div className="drawer-head">
              <div className="inline" style={{ gap: 12, alignItems: "flex-start" }}>
                <span className="metric-icon" aria-hidden="true">
                  <Building2 size={16} />
                </span>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 650 }}>{application.company}</h3>
                  <div className="muted base">{application.jobTitle}</div>
                  <div className="inline" style={{ gap: 6, marginTop: 8 }}>
                    <StatusBadge status={application.status} />
                    <SourceBadge source={application.source} />
                  </div>
                </div>
              </div>
              <IconButton label="Close details" onClick={onClose}>
                <X size={18} />
              </IconButton>
            </div>

            <div className="drawer-body">
              <div className="drawer-section">
                <h4>Update status</h4>
                <Select
                  aria-label="Update application status"
                  value={application.status}
                  onChange={(e) =>
                    onStatusChange(application.id, e.target.value as ApplicationStatus)
                  }
                >
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="drawer-section">
                <h4>Details</h4>
                <dl className="kv">
                  <dt>Applied</dt>
                  <dd>{formatDate(application.emailDate)}</dd>
                  <dt>Last updated</dt>
                  <dd>{formatDate(application.lastUpdated)}</dd>
                  <dt>Next follow-up</dt>
                  <dd>{formatDate(application.nextFollowUp)}</dd>
                  {application.location && (
                    <>
                      <dt>Location</dt>
                      <dd>{application.location}</dd>
                    </>
                  )}
                </dl>
              </div>

              <div className="drawer-section">
                <h4>Original email</h4>
                <dl className="kv">
                  <dt>From</dt>
                  <dd>{application.email.from || "—"}</dd>
                  <dt>Subject</dt>
                  <dd>{application.email.subject || "—"}</dd>
                  <dt>Received</dt>
                  <dd>{formatDate(application.email.receivedAt)}</dd>
                </dl>
                {application.email.snippet && (
                  /* Rendered as plain text only — email content is untrusted
                     and is never injected as HTML. */
                  <div className="email-snippet">{application.email.snippet}</div>
                )}
              </div>

              <div className="drawer-section">
                <div className="analysis-head">
                  <h4 style={{ margin: 0 }}>AI analysis</h4>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Sparkles size={14} />}
                    disabled={analyzing}
                    onClick={() => void runAnalysis()}
                  >
                    {analyzing ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
                  </Button>
                </div>
                {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
                {analyzing && <Spinner label="Running analysis…" />}
                {analysis ? (
                  <AnalysisPanel result={analysis} applicationId={application.id} />
                ) : (
                  !analyzing && (
                    <p className="muted base" style={{ margin: 0 }}>
                      Run the AI agent to extract details, classify status, and
                      check for scam warning signs. Results are labeled verified
                      or unverified depending on backend availability.
                    </p>
                  )
                )}
              </div>

              {application.notes && (
                <div className="drawer-section">
                  <h4>Notes</h4>
                  <p className="base" style={{ margin: 0 }}>{application.notes}</p>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
