/** Pure helpers for formatting, filtering, and sorting. Reused everywhere. */
import type {
  Application,
  ApplicationFilters,
  ApplicationStatus,
  SortState,
} from "../types";
import { APPLICATION_STATUSES, STATUS_LABELS } from "../types";

/** Color token (CSS var) per status, for pipeline/legend visualizations. */
export const STATUS_COLOR: Record<ApplicationStatus, string> = {
  applied: "#4f6bed",
  assessment: "#d08214",
  interview: "#7c3aed",
  offer: "#0f9d6b",
  rejected: "#9aa0ad",
};

export interface PipelineSegment {
  status: ApplicationStatus;
  label: string;
  count: number;
  color: string;
  pct: number;
}

/** Build pipeline segments from applications (count per status). */
export function buildPipeline(apps: Application[]): PipelineSegment[] {
  const total = apps.length || 1;
  return APPLICATION_STATUSES.map((status) => {
    const count = apps.filter((a) => a.status === status).length;
    return {
      status,
      label: STATUS_LABELS[status],
      count,
      color: STATUS_COLOR[status],
      pct: (count / total) * 100,
    };
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** A follow-up is "due" when its date is today or in the past. */
export function isFollowUpDue(app: Application): boolean {
  if (!app.nextFollowUp) return false;
  if (app.status === "offer" || app.status === "rejected") return false;
  const n = daysUntil(app.nextFollowUp);
  return n !== null && n <= 0;
}

export function filterApplications(
  apps: Application[],
  filters: ApplicationFilters,
): Application[] {
  const q = filters.search.trim().toLowerCase();
  return apps.filter((a) => {
    if (filters.status !== "all" && a.status !== filters.status) return false;
    if (!q) return true;
    return (
      a.company.toLowerCase().includes(q) ||
      a.jobTitle.toLowerCase().includes(q) ||
      a.email.from.toLowerCase().includes(q) ||
      a.email.subject.toLowerCase().includes(q) ||
      (a.location ?? "").toLowerCase().includes(q)
    );
  });
}

export function sortApplications(
  apps: Application[],
  sort: SortState,
): Application[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const copy = [...apps];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case "company":
        cmp = a.company.localeCompare(b.company);
        break;
      case "jobTitle":
        cmp = a.jobTitle.localeCompare(b.jobTitle);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "emailDate":
        cmp =
          new Date(a.emailDate).getTime() - new Date(b.emailDate).getTime();
        break;
    }
    return cmp * dir;
  });
  return copy;
}
