/**
 * App-wide data context. Loads applications through the DataService and
 * exposes actions (status change, import, reset) plus loading/error state.
 * Components never touch the service directly — they use useData().
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Application, ApplicationStatus } from "../types";
import { getDataService } from "../services";
import { useAuth } from "./AuthContext";

interface DataContextValue {
  applications: Application[];
  loading: boolean;
  error: string | null;
  backendLabel: string;
  refresh: () => Promise<void>;
  changeStatus: (id: string, status: ApplicationStatus) => Promise<void>;
  deleteApplication: (id: string) => Promise<void>;
  addImported: (apps: Application[]) => Promise<void>;
  resetToDemo: () => Promise<void>;
  clearError: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Service is re-created when the signed-in user changes, so one account's
  // data is never served to another.
  const service = useMemo(
    () => getDataService({ uid: user?.uid ?? null, isDemo: user?.isDemo ?? true }),
    [user?.uid, user?.isDemo],
  );
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setApplications(await service.listApplications());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeStatus = useCallback(
    async (id: string, status: ApplicationStatus) => {
      // Optimistic update for snappy UI; revert on failure.
      const prev = applications;
      setApplications((apps) =>
        apps.map((a) => (a.id === id ? { ...a, status } : a)),
      );
      try {
        const updated = await service.updateStatus(id, status);
        setApplications((apps) =>
          apps.map((a) => (a.id === id ? updated : a)),
        );
      } catch (e) {
        setApplications(prev);
        setError((e as Error).message);
      }
    },
    [applications, service],
  );

  const addImported = useCallback(
    async (apps: Application[]) => {
      setError(null);
      try {
        await service.addImported(apps);
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [service, refresh],
  );

  const deleteApplication = useCallback(
    async (id: string) => {
      const prev = applications;
      // Optimistic removal; revert + surface error on failure.
      setApplications((apps) => apps.filter((a) => a.id !== id));
      try {
        await service.deleteApplication(id);
      } catch (e) {
        setApplications(prev);
        setError((e as Error).message);
        throw e;
      }
    },
    [applications, service],
  );

  const resetToDemo = useCallback(async () => {
    setError(null);
    try {
      setApplications(await service.resetToDemo());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [service]);

  const value: DataContextValue = {
    applications,
    loading,
    error,
    backendLabel: service.backendLabel,
    refresh,
    changeStatus,
    deleteApplication,
    addImported,
    resetToDemo,
    clearError: () => setError(null),
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
