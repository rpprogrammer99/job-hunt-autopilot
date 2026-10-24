/**
 * Data-service abstraction.
 *
 * The UI depends only on this interface. Today it is backed by localStorage
 * (LocalDataService); later it can be swapped for Firestore
 * (FirestoreDataService) without touching any component.
 */
import type {
  Application,
  ApplicationStatus,
  ImportResult,
} from "../types";

export interface DataService {
  /** Load all applications for the current user. */
  listApplications(): Promise<Application[]>;

  /** Update a single application's status; returns the updated record. */
  updateStatus(
    id: string,
    status: ApplicationStatus,
  ): Promise<Application>;

  /** Persist an edited application. */
  updateApplication(app: Application): Promise<Application>;

  /** Delete an application. */
  deleteApplication(id: string): Promise<void>;

  /** Add imported applications (tagged source: "imported"). */
  addImported(apps: Application[]): Promise<void>;

  /**
   * Parse a raw file (JSON or MBOX) into applications WITHOUT persisting.
   * Reports counts/errors so the UI can show import progress + a summary.
   */
  parseImportFile(file: File): Promise<{
    result: ImportResult;
    applications: Application[];
  }>;

  /** Reset back to the seeded demo data (clears imported records). */
  resetToDemo(): Promise<Application[]>;

  /** A short human label describing the active backend. */
  readonly backendLabel: string;
}
