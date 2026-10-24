/**
 * localStorage-backed DataService. This is a TEMPORARY FALLBACK used while the
 * Firestore backend is not connected. Demo records are seeded on first run and
 * tagged `source: "demo"`; user-imported records are tagged `source:
 * "imported"`.
 */
import type {
  Application,
  ApplicationStatus,
  ImportResult,
} from "../types";
import type { DataService } from "./DataService";
import { SAMPLE_APPLICATIONS } from "./sampleData";
import { parseJson, parseMbox } from "./importParsers";

const STORAGE_KEY = "jha.applications.v1";
const FOLLOWUP_DAYS = 7;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Simulate async latency so loading states are exercised realistically. */
function delay<T>(value: T, ms = 350): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function computeNextFollowUp(status: ApplicationStatus, fromIso: string): string | null {
  // Terminal statuses don't need follow-ups.
  if (status === "offer" || status === "rejected") return null;
  const base = new Date(fromIso);
  if (isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + FOLLOWUP_DAYS);
  return base.toISOString();
}

export class LocalDataService implements DataService {
  readonly backendLabel = "Local demo (localStorage)";

  private read(): Application[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seeded = clone(SAMPLE_APPLICATIONS);
        this.write(seeded);
        return seeded;
      }
      return JSON.parse(raw) as Application[];
    } catch {
      const seeded = clone(SAMPLE_APPLICATIONS);
      this.write(seeded);
      return seeded;
    }
  }

  private write(apps: Application[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
  }

  async listApplications(): Promise<Application[]> {
    return delay(this.read());
  }

  async updateStatus(id: string, status: ApplicationStatus): Promise<Application> {
    const apps = this.read();
    const idx = apps.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error("Application not found");
    const now = new Date().toISOString();
    apps[idx] = {
      ...apps[idx],
      status,
      lastUpdated: now,
      nextFollowUp: computeNextFollowUp(status, now),
    };
    this.write(apps);
    return delay(apps[idx], 150);
  }

  async updateApplication(app: Application): Promise<Application> {
    const apps = this.read();
    const idx = apps.findIndex((a) => a.id === app.id);
    if (idx === -1) throw new Error("Application not found");
    apps[idx] = { ...app, lastUpdated: new Date().toISOString() };
    this.write(apps);
    return delay(apps[idx], 150);
  }

  async deleteApplication(id: string): Promise<void> {
    const apps = this.read().filter((a) => a.id !== id);
    this.write(apps);
    await delay(null, 150);
  }

  async addImported(newApps: Application[]): Promise<void> {
    const apps = this.read();
    this.write([...newApps, ...apps]);
    await delay(null, 150);
  }

  async parseImportFile(file: File): Promise<{
    result: ImportResult;
    applications: Application[];
  }> {
    const text = await file.text();
    const isJson = /\.json$/i.test(file.name);
    const isMbox = /\.(mbox|mbx)$/i.test(file.name);
    const errors: string[] = [];
    let applications: Application[] = [];
    let format: "json" | "mbox" = isMbox ? "mbox" : "json";

    try {
      if (isJson) {
        applications = parseJson(text);
        format = "json";
      } else if (isMbox) {
        applications = parseMbox(text);
        format = "mbox";
      } else {
        // Best-effort: try JSON first, then MBOX.
        try {
          applications = parseJson(text);
          format = "json";
        } catch {
          applications = parseMbox(text);
          format = "mbox";
        }
      }
    } catch (e) {
      errors.push((e as Error).message);
    }

    const result: ImportResult = {
      fileName: file.name,
      format,
      imported: applications.length,
      skipped: 0,
      errors,
    };
    return delay({ result, applications }, 400);
  }

  async resetToDemo(): Promise<Application[]> {
    const seeded = clone(SAMPLE_APPLICATIONS);
    this.write(seeded);
    return delay(seeded, 200);
  }
}
