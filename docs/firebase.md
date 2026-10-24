# Firebase Setup — Authentication & Cloud Firestore

This guide covers the Firebase project setup, authorized domains, local
emulator usage, and the security model. The app runs in **demo mode** with no
Firebase at all (`VITE_DEMO_MODE=true`); the steps below enable real Google
sign-in and per-user Cloud Firestore data.

## 1. Create the Firebase project
1. In the [Firebase Console](https://console.firebase.google.com), create a
   project (or use an existing Google Cloud project).
2. **Build → Authentication → Get started → Sign-in method →** enable
   **Google** as a provider.
3. **Build → Firestore Database → Create database.** Start in *production mode*
   (the rules in this repo enforce access); pick a region close to your users.

## 2. Register a Web App and copy the config
1. **Project settings → Your apps → Web (</>)** → register an app.
2. Copy the config values into `frontend/.env.local` (these are PUBLIC and safe
   to ship in the client bundle):
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_DEMO_MODE=false
   ```
3. Set the **backend** service identity for token verification: either
   `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json` locally, or
   rely on Application Default Credentials on Cloud Run. **Never** put this
   service-account file in the frontend or commit it.

> The Web API key is not a secret — it identifies the project, and Firestore
> Security Rules (not the key) control data access.

## 3. Authorized domains
Google sign-in only works from allow-listed domains.
**Authentication → Settings → Authorized domains** → ensure these are present:
- `localhost` (added by default) — for local dev.
- Your Firebase Hosting domains: `your-project.web.app` and
  `your-project.firebaseapp.com`.
- Any custom domain you deploy the frontend to.

## 4. Deploy rules and indexes
This repo ships `firestore.rules` and `firestore.indexes.json`, wired in
`firebase.json`.
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```
The rules are **deny-by-default**; a user can only read/write documents whose
`ownerUid` equals their authenticated UID (or under `/users/{uid}/...`).
**Do not replace them with permissive `allow read, write: if true;` rules.**

## 5. Local emulator (recommended for development)
Run Auth + Firestore locally without touching production data:
```bash
# One-time: npm i -g firebase-tools ; firebase login
firebase emulators:start --only auth,firestore
```
Then in `frontend/.env.local`:
```
VITE_DEMO_MODE=false
VITE_USE_FIREBASE_EMULATOR=true
```
The client connects to Auth on `127.0.0.1:9099` and Firestore on
`127.0.0.1:8080` (see `firebase.json`). The Emulator UI is available at the URL
printed on start. Emulator data is in-memory and reset on restart.

## 6. Data model (owner-scoped)
| Collection      | Ownership field / path        | Notes                                |
|-----------------|-------------------------------|--------------------------------------|
| `users`         | doc id = `{uid}`              | Profile; per-user subcollections OK  |
| `applications`  | `ownerUid`                    | Tracked applications                 |
| `emailMessages` | `ownerUid`                    | Imported/normalized messages         |
| `reminders`     | `ownerUid`                    | Follow-up reminders                  |
| `feedback`      | `ownerUid`                    | Create + read own; no update/delete  |

Every user-owned document carries `ownerUid`. The frontend `FirestoreDataService`
stamps `ownerUid` on every write and filters every read by it; the rules
enforce the same server-side.

## 7. Security notes
- The backend verifies Firebase **ID tokens** with the Admin SDK and derives
  the UID solely from the verified token — never from request bodies.
- Set `REQUIRE_AUTH=true` (and `DEV_MODE=false`) in production so the demo
  identity bypass is fully disabled.
- Demo mode and real accounts use separate identity namespaces
  (`demo:local-user` vs real Firebase UIDs), so demo data never mixes with real
  user data.
- The app never stores passwords, OTPs, or unnecessary sensitive identity data
  from emails, and never logs raw email bodies.
