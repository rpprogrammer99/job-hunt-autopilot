/// <reference types="vite/client" />

interface ImportMetaEnv {
  // App behavior
  readonly VITE_API_BASE_URL: string;
  // Demo mode is OFF unless explicitly "true". When off, real Firebase Auth
  // is required to access the dashboard.
  readonly VITE_DEMO_MODE: string;
  // Point the client at the local Firebase emulators.
  readonly VITE_USE_FIREBASE_EMULATOR: string;

  // Firebase web config (public values — safe to ship in the client bundle).
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
