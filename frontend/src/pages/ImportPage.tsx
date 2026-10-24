import { useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { parseJson, parseMbox } from "../services/importParsers";
import { commitImport, isBackendAvailable, previewImport } from "../services/importApi";
import {
  PageHeader,
  Card,
  Button,
  ErrorBanner,
  StatusBadge,
  SourceBadge,
  useToast,
} from "../components/ui";
import type { ApiImportPreview, ApiParsedMessage, Application } from "../types";
import type { Route } from "../lib/router";

type Phase = "idle" | "parsing" | "preview" | "done" | "error";
const MAX_MB = 10;

function deriveCompany(sender: string, subject: string): string {
  const at = subject.match(/\bat\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/);
  if (at) return at[1].trim().replace(/\.$/, "");
  const dom = sender.match(/@([\w.-]+)/);
  if (dom) {
    const parts = dom[1].split(".");
    let root = parts[0];
    if (["careers", "no", "noreply", "no-reply", "hr", "talent", "jobs"].includes(root)) {
      root = parts.length >= 2 ? parts[parts.length - 2] : root;
    }
    return root.charAt(0).toUpperCase() + root.slice(1);
  }
  return "Unknown Company";
}

function messageToApplication(m: ApiParsedMessage): Application {
  const date = m.date ?? new Date().toISOString();
  return {
    id: `import-${m.index}-${m.fingerprint.slice(0, 8) || m.index}`,
    company: deriveCompany(m.sender, m.subject),
    jobTitle: m.subject || "Unknown Role",
    status: "applied",
    emailDate: date,
    lastUpdated: new Date().toISOString(),
    nextFollowUp: null,
    source: "imported",
    email: {
      from: m.sender,
      subject: m.subject,
      receivedAt: date,
      snippet: m.body.slice(0, 280),
    },
    scam: { suspicious: false, reasons: [], provider: "demo" },
  };
}

export function ImportPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { addImported, refresh } = useData();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [preview, setPreview] = useState<ApiImportPreview | null>(null);
  const [messages, setMessages] = useState<ApiParsedMessage[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [usingBackend, setUsingBackend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; failed: number } | null>(null);

  useEffect(() => {
    isBackendAvailable().then(setBackendUp);
  }, []);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);
    setMessages([]);
    setApps([]);
    setSummary(null);

    if (!/\.(json|mbox|mbx)$/i.test(file.name)) {
      setError("Unsupported file type. Please upload a .json or .mbox file.");
      setPhase("error");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large. The maximum size is ${MAX_MB} MB.`);
      setPhase("error");
      return;
    }

    setFileInfo({ name: file.name, size: file.size });
    setPhase("parsing");
    setProgress(30);
    const online = backendUp ?? (await isBackendAvailable());
    setBackendUp(online);

    try {
      setProgress(65);
      if (online) {
        const result = await previewImport(file);
        setProgress(100);
        setUsingBackend(true);
        setPreview(result);
        setMessages(result.messages);
        setApps(result.messages.map(messageToApplication));
        setPhase("preview");
      } else {
        const isJson = /\.json$/i.test(file.name);
        const text = await file.text();
        const localErrors: string[] = [];
        let applications: Application[] = [];
        let fmt: "json" | "mbox" = isJson ? "json" : "mbox";
        try {
          applications = isJson ? parseJson(text) : parseMbox(text);
        } catch (e) {
          localErrors.push((e as Error).message);
        }
        setProgress(100);
        setUsingBackend(false);
        if (localErrors.length > 0 && applications.length === 0) {
          setError(localErrors.join(" "));
          setPhase("error");
          return;
        }
        setApps(applications);
        setPreview({
          format: fmt,
          file_name: file.name,
          total_messages: applications.length,
          parsed_count: applications.length,
          error_count: localErrors.length,
          duplicate_count: 0,
          messages: [],
          errors: localErrors.map((e, i) => ({ index: i, error: e })),
          duplicates: [],
        });
        setPhase("preview");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function confirmImport() {
    if (apps.length === 0) return;
    setCommitting(true);
    try {
      let result = { imported: apps.length, skipped: 0, failed: 0 };
      if (usingBackend && messages.length > 0) {
        const r = await commitImport(messages);
        result = { imported: r.imported, skipped: r.skipped, failed: r.failed };
      }
      await addImported(apps);
      await refresh();
      setSummary(result);
      setPhase("done");
      toast.success(`Imported ${result.imported} application${result.imported === 1 ? "" : "s"}.`);
    } catch (e) {
      setError((e as Error).message);
      toast.error("Import failed.");
      setPhase("error");
    } finally {
      setCommitting(false);
    }
  }

  function reset() {
    setPhase("idle");
    setProgress(0);
    setFileInfo(null);
    setPreview(null);
    setMessages([]);
    setApps([]);
    setError(null);
    setSummary(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const stepIndex = phase === "idle" || phase === "error" ? 0 : phase === "parsing" || phase === "preview" ? 1 : 2;

  return (
    <div className="page">
      <PageHeader
        title="Import Emails"
        subtitle="Bring in recruiting emails from a JSON or MBOX export"
      />

      <div className="stepper" aria-label="Import steps">
        {["Upload", "Review", "Done"].map((label, i) => (
          <div
            key={label}
            className={`step ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
          >
            <span className="step-num">{i < stepIndex ? "✓" : i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => { setError(null); setPhase("idle"); }} />
      )}

      {/* Step 1: upload */}
      {(phase === "idle" || phase === "parsing" || phase === "error") && (
        <Card>
          <p className="muted base" style={{ marginTop: 0 }}>
            {backendUp === false
              ? "The backend is offline — files are parsed locally in your browser as a fallback."
              : "Files are validated and parsed on the backend. Email bodies are never sent to AI during parsing."}
          </p>
          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
          >
            <span className="dropzone-icon" aria-hidden="true">
              <UploadCloud size={22} />
            </span>
            <p style={{ margin: 0, fontWeight: 600 }}>Drag &amp; drop a file here</p>
            <p className="muted small" style={{ margin: 0 }}>
              or
            </p>
            <Button
              variant="primary"
              disabled={phase === "parsing"}
              onClick={() => fileInput.current?.click()}
            >
              Browse files
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.mbox,.mbx"
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <p className="muted small" style={{ margin: 0 }}>
              Accepted: JSON, MBOX · Max {MAX_MB} MB
            </p>
          </div>

          {phase === "parsing" && (
            <div style={{ marginTop: 16 }}>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="muted small" style={{ marginTop: 6 }}>Parsing emails…</p>
            </div>
          )}
        </Card>
      )}

      {/* Step 2: preview + confirm */}
      {phase === "preview" && preview && (
        <Card>
          {fileInfo && (
            <div className="inline" style={{ gap: 10, marginBottom: 16 }}>
              <FileText size={18} className="muted" />
              <div>
                <div style={{ fontWeight: 600 }}>{fileInfo.name}</div>
                <div className="muted small">
                  {(fileInfo.size / 1024).toFixed(1)} KB · {preview.format.toUpperCase()} ·{" "}
                  {usingBackend ? "parsed on backend" : "parsed locally"}
                </div>
              </div>
            </div>
          )}

          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 16 }}>
            <div className="metric-card">
              <span className="metric-label">Parsed</span>
              <span className="metric-value">{preview.parsed_count}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Duplicates</span>
              <span className="metric-value">{preview.duplicate_count}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Errors</span>
              <span className="metric-value">{preview.error_count}</span>
            </div>
          </div>

          {preview.error_count > 0 && (
            <div className="info-note warning" style={{ marginBottom: 16 }}>
              <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              {preview.error_count} record{preview.error_count === 1 ? "" : "s"} could not be
              parsed and will be skipped.
            </div>
          )}

          {apps.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <div className="table-scroll">
                <table className="data-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th className="th-plain">Company</th>
                      <th className="th-plain">Job Title</th>
                      <th className="th-plain">Status</th>
                      <th className="th-plain">From</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.slice(0, 8).map((a) => (
                      <tr key={a.id}>
                        <td className="cell-primary">{a.company}</td>
                        <td>{a.jobTitle}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td className="cell-muted">{a.email.from || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {apps.length > 8 && (
            <p className="muted small">…and {apps.length - 8} more.</p>
          )}

          <p className="muted base">
            Records will be tagged <SourceBadge source="imported" />.
          </p>

          <div className="row-actions">
            {apps.length > 0 ? (
              <Button variant="primary" disabled={committing} onClick={() => void confirmImport()}>
                {committing ? "Importing…" : `Import ${apps.length} application${apps.length === 1 ? "" : "s"}`}
              </Button>
            ) : null}
            <Button onClick={reset}>Choose a different file</Button>
          </div>
        </Card>
      )}

      {/* Step 3: done */}
      {phase === "done" && summary && (
        <Card>
          <div className="inline" style={{ gap: 10, marginBottom: 12, color: "var(--success)" }}>
            <CheckCircle2 size={20} />
            <h2 style={{ margin: 0 }}>Import complete</h2>
          </div>
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="metric-card">
              <span className="metric-label">Imported</span>
              <span className="metric-value">{summary.imported}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Skipped</span>
              <span className="metric-value">{summary.skipped}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Failed</span>
              <span className="metric-value">{summary.failed}</span>
            </div>
          </div>
          <div className="row-actions" style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={() => onNavigate("applications")}>
              View applications
            </Button>
            <Button onClick={reset}>Import another file</Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 style={{ marginBottom: 12 }}>Expected JSON format</h2>
        <pre className="code-sample">{`[
  {
    "message_id": "<id@mail>",
    "sender": "careers@acmecloud.com",
    "recipient": "me@example.com",
    "subject": "Thanks for applying — Software Engineer at Acme Cloud",
    "date": "2026-10-15T08:45:00Z",
    "body": "We received your application…",
    "source": "gmail"
  }
]`}</pre>
      </Card>
    </div>
  );
}
