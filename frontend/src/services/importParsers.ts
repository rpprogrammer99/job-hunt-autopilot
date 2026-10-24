/**
 * File import parsers.
 *
 * Converts uploaded JSON / MBOX files into Application records. These are
 * deterministic structural parsers — they do NOT perform AI analysis. Any
 * scam field produced here is marked `provider: "demo"` and flagged as
 * non-authoritative until the backend is connected.
 */
import type {
  Application,
  ApplicationStatus,
  ExtractedEmail,
} from "../types";
import { APPLICATION_STATUSES } from "../types";

function makeId(): string {
  return `imp-${Math.random().toString(36).slice(2, 10)}`;
}

function coerceStatus(value: unknown): ApplicationStatus {
  const v = String(value ?? "").toLowerCase();
  return (APPLICATION_STATUSES as string[]).includes(v)
    ? (v as ApplicationStatus)
    : "applied";
}

function buildApplication(partial: {
  company?: string;
  jobTitle?: string;
  location?: string;
  status?: unknown;
  emailDate?: string;
  email: ExtractedEmail;
  notes?: string;
}): Application {
  const emailDate = partial.emailDate || partial.email.receivedAt || new Date().toISOString();
  return {
    id: makeId(),
    company: partial.company?.trim() || "Unknown Company",
    jobTitle: partial.jobTitle?.trim() || "Unknown Role",
    location: partial.location,
    status: coerceStatus(partial.status),
    emailDate,
    lastUpdated: new Date().toISOString(),
    nextFollowUp: null,
    source: "imported",
    email: partial.email,
    // Imported records have no backend verdict yet — explicitly "not analyzed".
    scam: { suspicious: false, reasons: [], provider: "demo" },
    notes: partial.notes,
  };
}

/** Parse a JSON file. Accepts an array of records or {applications:[...]}. */
export function parseJson(text: string): Application[] {
  const data = JSON.parse(text);
  const rows: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { applications?: unknown[] })?.applications)
      ? (data as { applications: unknown[] }).applications
      : [];
  if (rows.length === 0) {
    throw new Error("No records found. Expected a JSON array of applications.");
  }
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const email: ExtractedEmail = {
      from: String(r.from ?? (r.email as Record<string, unknown>)?.from ?? ""),
      subject: String(r.subject ?? (r.email as Record<string, unknown>)?.subject ?? ""),
      receivedAt: String(
        r.emailDate ?? r.received_at ?? (r.email as Record<string, unknown>)?.receivedAt ?? new Date().toISOString(),
      ),
      snippet: String(r.body ?? r.snippet ?? (r.email as Record<string, unknown>)?.snippet ?? "").slice(0, 280),
    };
    return buildApplication({
      company: (r.company as string) ?? undefined,
      jobTitle: (r.jobTitle as string) ?? (r.role as string) ?? undefined,
      location: (r.location as string) ?? undefined,
      status: r.status,
      emailDate: email.receivedAt,
      email,
      notes: (r.notes as string) ?? undefined,
    });
  });
}

/**
 * Parse a simplified MBOX file. We split on "From " at line start and extract
 * From:/Subject:/Date: headers plus a body snippet. This is a pragmatic parser
 * suitable for the prototype, not a full RFC-4155 implementation.
 */
export function parseMbox(text: string): Application[] {
  const messages = text
    .split(/^From .*$/m)
    .map((m) => m.trim())
    .filter(Boolean);

  if (messages.length === 0) {
    throw new Error("No messages found in the MBOX file.");
  }

  return messages.map((msg) => {
    const header = (name: string): string => {
      const re = new RegExp(`^${name}:\\s*(.*)$`, "im");
      const m = msg.match(re);
      return m ? m[1].trim() : "";
    };
    const from = header("From");
    const subject = header("Subject");
    const dateHeader = header("Date");
    const received = dateHeader ? new Date(dateHeader) : new Date();
    const receivedAt = isNaN(received.getTime())
      ? new Date().toISOString()
      : received.toISOString();

    // Body = everything after the first blank line.
    const blank = msg.indexOf("\n\n");
    const body = blank >= 0 ? msg.slice(blank + 2) : "";

    // Infer company from the sender domain.
    const domainMatch = from.match(/@([\w.-]+)/);
    const company = domainMatch
      ? domainMatch[1].split(".")[0].replace(/^\w/, (c) => c.toUpperCase())
      : "Unknown Company";

    const email: ExtractedEmail = {
      from,
      subject,
      receivedAt,
      snippet: body.replace(/\s+/g, " ").trim().slice(0, 280),
    };
    return buildApplication({
      company,
      jobTitle: subject || "Unknown Role",
      emailDate: receivedAt,
      email,
    });
  });
}
