/**
 * Firestore-backed DataService.
 *
 * Every document is written with an `ownerUid` equal to the signed-in user and
 * every query is filtered by `ownerUid`, matching the Firestore Security
 * Rules. The frontend can therefore only read/write its own records; the
 * rules enforce this server-side regardless of client behavior.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "../firebase";
import type { Application, ApplicationStatus, ImportResult } from "../types";
import type { DataService } from "./DataService";
import { parseJson, parseMbox } from "./importParsers";

const COLLECTION = "applications";
const FOLLOWUP_DAYS = 7;

function computeNextFollowUp(status: ApplicationStatus, fromIso: string): string | null {
  if (status === "offer" || status === "rejected") return null;
  const base = new Date(fromIso);
  if (isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + FOLLOWUP_DAYS);
  return base.toISOString();
}

function newId(): string {
  return `app-${Math.random().toString(36).slice(2, 11)}`;
}

/** Strip Firestore-only fields and coerce into the UI Application shape. */
function toApplication(id: string, data: Record<string, unknown>): Application {
  return {
    id,
    company: String(data.company ?? ""),
    jobTitle: String(data.jobTitle ?? ""),
    location: (data.location as string) ?? undefined,
    status: (data.status as ApplicationStatus) ?? "applied",
    emailDate: String(data.emailDate ?? new Date().toISOString()),
    lastUpdated: String(data.lastUpdated ?? new Date().toISOString()),
    nextFollowUp: (data.nextFollowUp as string | null) ?? null,
    source: (data.source as Application["source"]) ?? "imported",
    email: (data.email as Application["email"]) ?? {
      from: "",
      subject: "",
      receivedAt: "",
      snippet: "",
    },
    scam: (data.scam as Application["scam"]) ?? {
      suspicious: false,
      reasons: [],
      provider: "demo",
    },
    notes: (data.notes as string) ?? undefined,
  };
}

export class FirestoreDataService implements DataService {
  readonly backendLabel = "Cloud Firestore";

  constructor(private readonly ownerUid: string) {
    if (!ownerUid) throw new Error("FirestoreDataService requires an owner uid.");
  }

  private col() {
    return collection(getDb(), COLLECTION);
  }

  /** Document payload always stamps ownerUid = the signed-in user. */
  private payload(app: Application): Record<string, unknown> {
    return {
      ownerUid: this.ownerUid,
      company: app.company,
      jobTitle: app.jobTitle,
      location: app.location ?? null,
      status: app.status,
      emailDate: app.emailDate,
      lastUpdated: app.lastUpdated,
      nextFollowUp: app.nextFollowUp,
      source: app.source,
      email: app.email,
      scam: app.scam,
      notes: app.notes ?? "",
      updatedAt: serverTimestamp(),
    };
  }

  async listApplications(): Promise<Application[]> {
    const q = query(this.col(), where("ownerUid", "==", this.ownerUid));
    const snap = await getDocs(q);
    const apps = snap.docs.map((d) => toApplication(d.id, d.data()));
    apps.sort(
      (a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
    );
    return apps;
  }

  async updateStatus(id: string, status: ApplicationStatus): Promise<Application> {
    const now = new Date().toISOString();
    const ref = doc(this.col(), id);
    await updateDoc(ref, {
      status,
      lastUpdated: now,
      nextFollowUp: computeNextFollowUp(status, now),
      updatedAt: serverTimestamp(),
    });
    const apps = await this.listApplications();
    const found = apps.find((a) => a.id === id);
    if (!found) throw new Error("Application not found after update");
    return found;
  }

  async updateApplication(app: Application): Promise<Application> {
    const updated = { ...app, lastUpdated: new Date().toISOString() };
    await setDoc(doc(this.col(), app.id), this.payload(updated));
    return updated;
  }

  async deleteApplication(id: string): Promise<void> {
    await deleteDoc(doc(this.col(), id));
  }

  async addImported(apps: Application[]): Promise<void> {
    const batch = writeBatch(getDb());
    for (const a of apps) {
      const id = a.id && a.id.startsWith("app-") ? a.id : newId();
      batch.set(doc(this.col(), id), this.payload({ ...a, id }));
    }
    await batch.commit();
  }

  async parseImportFile(file: File): Promise<{
    result: ImportResult;
    applications: Application[];
  }> {
    // Parsing is client-side and does not persist. Persistence happens in
    // addImported after the user confirms.
    const text = await file.text();
    const isJson = /\.json$/i.test(file.name);
    const isMbox = /\.(mbox|mbx)$/i.test(file.name);
    const errors: string[] = [];
    let applications: Application[] = [];
    let format: "json" | "mbox" = isMbox ? "mbox" : "json";
    try {
      if (isJson) {
        applications = parseJson(text);
      } else if (isMbox) {
        applications = parseMbox(text);
        format = "mbox";
      } else {
        try {
          applications = parseJson(text);
        } catch {
          applications = parseMbox(text);
          format = "mbox";
        }
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
    return {
      result: {
        fileName: file.name,
        format,
        imported: applications.length,
        skipped: 0,
        errors,
      },
      applications,
    };
  }

  async resetToDemo(): Promise<Application[]> {
    // Firestore is real user data; we do NOT seed demo content into it.
    throw new Error(
      "Reset to demo is only available in demo mode, not for a real account.",
    );
  }
}
