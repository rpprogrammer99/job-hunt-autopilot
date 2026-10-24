/**
 * Chooses the active DataService based on auth state.
 *
 *   * Demo mode OR the reserved demo identity -> LocalDataService
 *     (localStorage, seeded demo data). Explicit-only; never mixes with a
 *     real account.
 *   * A real signed-in user -> FirestoreDataService scoped to their uid.
 *
 * The instance is cached per owner uid so switching accounts yields a fresh
 * service (and never serves another user's cached data).
 */
import type { DataService } from "./DataService";
import { LocalDataService } from "./LocalDataService";
import { FirestoreDataService } from "./FirestoreDataService";

let cached: { key: string; service: DataService } | null = null;

export interface ServiceOwner {
  uid: string | null;
  isDemo: boolean;
}

export function getDataService(owner: ServiceOwner): DataService {
  const key = owner.isDemo || !owner.uid ? "demo" : `firestore:${owner.uid}`;
  if (cached && cached.key === key) return cached.service;

  const service: DataService =
    owner.isDemo || !owner.uid
      ? new LocalDataService()
      : new FirestoreDataService(owner.uid);

  cached = { key, service };
  return service;
}

/** Clear the cached service (e.g. on sign-out) so no stale data is reused. */
export function resetDataService(): void {
  cached = null;
}
