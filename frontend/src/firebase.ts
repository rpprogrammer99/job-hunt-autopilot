/**
 * Firebase client initialization (official modular SDK v11).
 *
 * Security:
 *   * Only the PUBLIC Firebase web config lives here. These values are safe to
 *     ship to the browser. Admin credentials are NEVER used in the frontend.
 *   * Demo mode is OFF by default. It is enabled ONLY when
 *     VITE_DEMO_MODE === "true", so real user data is never silently replaced
 *     by demo data (and vice-versa).
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

const env = import.meta.env;

/** Demo mode is explicit-only. */
export const DEMO_MODE = env.VITE_DEMO_MODE === "true";

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** True when we have enough config to initialize Firebase. */
export const FIREBASE_CONFIGURED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (!DEMO_MODE && FIREBASE_CONFIGURED) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);

  if (env.VITE_USE_FIREBASE_EMULATOR === "true") {
    // Local emulator suite (see firebase.json).
    connectAuthEmulator(authInstance, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
  }
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    throw new Error("Firebase Auth is not initialized (demo mode or missing config).");
  }
  return authInstance;
}

export function getDb(): Firestore {
  if (!dbInstance) {
    throw new Error("Firestore is not initialized (demo mode or missing config).");
  }
  return dbInstance;
}

export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  fbSignOut as signOut,
  onAuthStateChanged,
  type User,
};
