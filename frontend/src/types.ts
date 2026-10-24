/**
 * Shared TypeScript types for Job Hunt Autopilot frontend.
 * Single source of truth — no type should be redefined inside components.
 */

/** The five application statuses tracked by the product. */
export type ApplicationStatus =
  | "applied"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
];

/** Human-readable labels for each status. */
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

/** Where a record came from. Drives the demo-vs-real labeling in the UI. */
export type DataSource = "demo" | "imported";

/**
 * Scam / suspicious-email analysis.
 *
 * `provider` makes the source of the verdict explicit. Until the backend AI
 * is connected, demo records carry `provider: "demo"` and the UI labels the
 * analysis as non-authoritative. We never fabricate an "AI" verdict.
 */
export interface ScamAnalysis {
  suspicious: boolean;
  reasons: string[];
  /** "demo" = placeholder heuristic shown in the prototype.
   *  "backend" = real analysis returned by the API. */
  provider: "demo" | "backend";
}

/** Structured fields extracted from the source email. */
export interface ExtractedEmail {
  from: string;
  subject: string;
  receivedAt: string; // ISO date
  snippet: string;
}

export interface Application {
  id: string;
  company: string;
  jobTitle: string;
  location?: string;
  status: ApplicationStatus;
  /** Date the application email was received (ISO). */
  emailDate: string;
  /** Date of the last status change / update (ISO). */
  lastUpdated: string;
  /** Computed next follow-up date (ISO) or null if none applies. */
  nextFollowUp: string | null;
  source: DataSource;
  email: ExtractedEmail;
  scam: ScamAnalysis;
  notes?: string;
}

/** Fields a user can edit when creating/updating an application. */
export type ApplicationDraft = Omit<
  Application,
  "id" | "lastUpdated" | "nextFollowUp"
>;

/** Filters applied on the Applications page. */
export interface ApplicationFilters {
  search: string;
  status: ApplicationStatus | "all";
}

export type SortField = "company" | "jobTitle" | "emailDate" | "status";
export type SortDirection = "asc" | "desc";

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

/** Result of an import attempt, surfaced to the UI. */
export interface ImportResult {
  fileName: string;
  format: "json" | "mbox";
  imported: number;
  skipped: number;
  errors: string[];
}

// --------------------------------------------------------------------------
// Backend email-import API shapes (mirror the FastAPI models).
// --------------------------------------------------------------------------

export interface ApiParsedMessage {
  message_id: string | null;
  sender: string;
  recipient: string;
  subject: string;
  date: string | null;
  body: string;
  source: string;
  fingerprint: string;
  index: number;
}

export interface ApiMessageParseError {
  index: number;
  error: string;
}

export interface ApiDuplicateCandidate {
  index: number;
  reason: "message_id" | "fingerprint";
  key: string;
}

export interface ApiImportPreview {
  format: "json" | "mbox";
  file_name: string;
  total_messages: number;
  parsed_count: number;
  error_count: number;
  duplicate_count: number;
  messages: ApiParsedMessage[];
  errors: ApiMessageParseError[];
  duplicates: ApiDuplicateCandidate[];
}

export interface ApiImportCommitResult {
  imported: number;
  skipped: number;
  failed: number;
  imported_ids: string[];
  errors: string[];
}

// --------------------------------------------------------------------------
// AI analysis API shapes (mirror app/analysis_schema.py).
// --------------------------------------------------------------------------

export type AnalysisPrimaryStatus =
  | "applied"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected";

export type AnalysisRiskLevel = "low" | "medium" | "high";

export interface AnalysisExtraction {
  company_name: string | null;
  job_title: string | null;
  recruiter_name: string | null;
  recruiter_email: string | null;
  application_or_interview_date: string | null;
  interview_or_assessment_details: string | null;
  salary_information: string | null;
  required_next_action: string | null;
  recommended_follow_up_date: string | null;
}

export interface AnalysisClassification {
  primary_status: AnalysisPrimaryStatus;
  confidence: number;
  explanation: string;
}

export type AnalysisRiskCategory =
  | "payment"
  | "credential_theft"
  | "domain_mismatch"
  | "suspicious_url"
  | "urgency"
  | "other";

export interface AnalysisRiskSignal {
  category: AnalysisRiskCategory;
  label: string;
  explanation: string;
  evidence: string[];
  source: string;
}

export interface AnalysisScamWarning {
  risk_level: AnalysisRiskLevel;
  risk_score: number;
  signals: AnalysisRiskSignal[];
  risk_signals: string[];
  evidence: string[];
  plain_explanation: string;
  counter_evidence: string[];
  uncertainty: string;
  recommendation: string;
  disclaimer: string;
  deterministic_override: boolean;
  conflict_explanation: string;
}

export interface AnalysisResult {
  extraction: AnalysisExtraction;
  classification: AnalysisClassification;
  scam_warning: AnalysisScamWarning;
  verified: boolean;
  source: string;
  model: string | null;
  notes: string;
}

// --------------------------------------------------------------------------
// Follow-up reminder API shapes (mirror app/models.py).
// --------------------------------------------------------------------------

export type ReminderStatus =
  | "overdue"
  | "due_today"
  | "upcoming"
  | "dismissed"
  | "obsolete";

export interface ReminderRecord {
  id: string;
  user_id: string;
  application_id: string;
  company: string;
  role: string;
  base_date: string | null;
  due_date: string | null;
  reason: string;
  status: ReminderStatus;
  suggested_action: string;
  cycle_key: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface GroupedReminders {
  overdue: ReminderRecord[];
  due_today: ReminderRecord[];
  upcoming: ReminderRecord[];
  dismissed: ReminderRecord[];
}

export interface DraftResponse {
  subject: string;
  body: string;
  source: string;
  disclaimer: string;
}
