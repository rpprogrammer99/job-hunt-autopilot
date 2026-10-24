/**
 * Thin client for the backend email-import endpoints
 * (/api/import/preview and /api/import/commit).
 *
 * The ImportPage uses this when the backend is reachable, and falls back to
 * local in-browser parsing otherwise — so the prototype keeps working offline.
 */
import type {
  ApiImportPreview,
  ApiImportCommitResult,
  ApiParsedMessage,
} from "../types";
import { authHeaders } from "./authToken";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/** Quick health probe so the UI can choose backend vs local parsing. */
export async function isBackendAvailable(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BASE}/health`, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function previewImport(file: File): Promise<ApiImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/import/preview`, {
    method: "POST",
    headers: await authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const detail = await extractDetail(res);
    throw new Error(detail);
  }
  return (await res.json()) as ApiImportPreview;
}

export async function commitImport(
  messages: ApiParsedMessage[],
): Promise<ApiImportCommitResult> {
  const res = await fetch(`${BASE}/api/import/commit`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const detail = await extractDetail(res);
    throw new Error(detail);
  }
  return (await res.json()) as ApiImportCommitResult;
}

async function extractDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    return `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
