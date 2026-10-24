/** Client for the AI analysis endpoint (/api/analyze). */
import type { AnalysisResult, Application } from "../types";
import { authHeaders } from "./authToken";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/** Analyze one application's source email via the backend agent. */
export async function analyzeApplication(
  app: Application,
): Promise<AnalysisResult> {
  const payload = {
    from: app.email.from,
    subject: app.email.subject,
    body: app.email.snippet,
    received_at: app.email.receivedAt,
  };
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = `Analysis failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as AnalysisResult;
}

/** Record user feedback on a scam-warning signal (helpful / incorrect). */
export async function sendRiskFeedback(payload: {
  application_id?: string | null;
  signal_label?: string | null;
  helpful: boolean;
  comment?: string;
}): Promise<{ recorded: boolean; total_feedback: number }> {
  const res = await fetch(`${BASE}/api/risk-feedback`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Feedback failed (${res.status})`);
  return (await res.json()) as { recorded: boolean; total_feedback: number };
}
