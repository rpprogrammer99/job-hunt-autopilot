/**
 * Authentication context.
 *
 * Exposes the current user, loading/error state, sign-in/out actions, and a
 * getIdToken() used to authenticate backend calls. In explicit demo mode it
 * provides a reserved demo identity WITHOUT touching Firebase, so demo and
 * real data never mix.
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
import {
  DEMO_MODE,
  FIREBASE_CONFIGURED,
  getFirebaseAuth,
  googleProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "../firebase";

import { registerTokenGetter } from "../services/authToken";

export interface AuthUser {
  uid: string;
  name: string;
  email: string;
  photoURL?: string | null;
  isDemo: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  demoMode: boolean;
  firebaseReady: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The reserved demo identity. Mirrors the backend DEMO_USER_ID namespace.
const DEMO_USER: AuthUser = {
  uid: "demo:local-user",
  name: "Demo User",
  email: "demo@example.com",
  isDemo: true,
};

function toAuthUser(u: User): AuthUser {
  return {
    uid: u.uid,
    name: u.displayName ?? "",
    email: u.email ?? "",
    photoURL: u.photoURL,
    isDemo: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(DEMO_MODE ? DEMO_USER : null);
  const [loading, setLoading] = useState(!DEMO_MODE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO_MODE) {
      // Explicit demo mode: no Firebase, fixed demo identity.
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }
    if (!FIREBASE_CONFIGURED) {
      setLoading(false);
      setError(
        "Firebase is not configured. Set VITE_FIREBASE_* in frontend/.env.local, " +
          "or enable demo mode with VITE_DEMO_MODE=true.",
      );
      return;
    }
    // Subscribe to real auth state. Until this resolves we stay in loading so
    // protected data is never shown before auth is verified.
    const unsub = onAuthStateChanged(
      getFirebaseAuth(),
      (u) => {
        setUser(u ? toAuthUser(u) : null);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (DEMO_MODE) return;
    setError(null);
    try {
      await signInWithPopup(getFirebaseAuth(), googleProvider);
      // onAuthStateChanged will populate the user.
    } catch (e) {
      const msg = (e as { code?: string; message?: string }).code
        ? `Sign-in failed (${(e as { code: string }).code}).`
        : (e as Error).message;
      setError(msg);
    }
  }, []);

  const logout = useCallback(async () => {
    if (DEMO_MODE) return;
    setError(null);
    try {
      await signOut(getFirebaseAuth());
      setUser(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (DEMO_MODE) return null;
    const current = getFirebaseAuth().currentUser;
    return current ? current.getIdToken() : null;
  }, []);

  // Let plain fetch-based API modules attach the ID token.
  useEffect(() => {
    registerTokenGetter(getIdToken);
  }, [getIdToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      demoMode: DEMO_MODE,
      firebaseReady: FIREBASE_CONFIGURED,
      signInWithGoogle,
      logout,
      getIdToken,
      clearError: () => setError(null),
    }),
    [user, loading, error, signInWithGoogle, logout, getIdToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
