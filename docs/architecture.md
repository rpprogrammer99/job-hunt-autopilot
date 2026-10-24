# Architecture

Job Hunt Autopilot is a two-tier app: a React/TypeScript frontend and a
FastAPI backend, with Google Cloud services for AI, data, auth, hosting, and
scheduling. It is **local-first**: when cloud credentials are absent it runs
entirely offline using sample data and a deterministic AI fallback.

```
                         ┌──────────────────────────────┐
                         │   Firebase Hosting (SPA)      │
                         │   React + TypeScript + Vite   │
                         └───────────────┬──────────────┘
                                         │ HTTPS + Firebase ID token (Bearer)
                                         ▼
                         ┌──────────────────────────────┐
                         │   Cloud Run (FastAPI)         │
                         │   - /api/applications (CRUD)  │
                         │   - /api/emails/parse|import  │
                         │   - /api/reminders            │
                         │   - /api/scheduler/* (token)  │
                         └───┬───────────┬───────────┬───┘
                             │           │           │
             verify ID token │           │ parse     │ read/write
                             ▼           ▼           ▼
                    ┌──────────────┐ ┌─────────┐ ┌─────────────┐
                    │ Firebase Auth│ │ Gemini  │ │ Firestore   │
                    │              │ │ (GenAI  │ │ (applications)
                    │              │ │  + ADK) │ │             │
                    └──────────────┘ └─────────┘ └─────────────┘
                                         ▲
              Cloud Scheduler ───────────┘ (POST /api/scheduler/run-reminders
              (cron, every day)             with X-Scheduler-Token secret)
```

## Components

### Frontend (`frontend/`)
- **React + TypeScript + Vite** SPA.
- `firebase.ts` wraps Firebase Authentication. In `VITE_DEV_MODE=true` (or when
  no web config is present) it bypasses sign-in and uses a `dev-user`.
- `api.ts` is a typed client that attaches the Firebase ID token as a
  `Bearer` header when available.
- **No secrets** live in the frontend. The only Firebase values present are the
  public web config (safe to ship). Service account keys and the scheduler
  token never appear here.

### Backend (`backend/app/`)
- **FastAPI** app exposing the API under `/api` plus a `/health` probe.
- `auth.py` verifies Firebase ID tokens via `firebase-admin`. In `DEV_MODE` it
  returns a fixed `dev-user` so the app works without real auth.
- `agent.py` is the AI layer:
  - **Primary:** Gemini via the Google Gen AI SDK (`google-genai`), optionally
    through Vertex AI, with Google ADK available for orchestration.
  - **Fallback:** a deterministic rule-based parser + suspicious-email
    detector. This guarantees the app works offline and makes the logic unit
    testable. The rule-based suspicious detector always runs as a safety net.
- `firestore_client.py` provides a `FirestoreStore` (real Cloud Firestore) and
  an `InMemoryStore` seeded from `sample-data/`. Selection is automatic based
  on configuration.
- `reminders.py` computes 7-day follow-up reminders for open, non-suspicious
  applications.

### Scheduled processing
`POST /api/scheduler/run-reminders` is protected by a shared secret
(`X-Scheduler-Token`). Google Cloud Scheduler is configured to call it on a
cron schedule. The endpoint computes the reminder batch across users.

## Data model (`applications` collection)
| Field               | Type     | Notes                                      |
|---------------------|----------|--------------------------------------------|
| `id`                | string   | Document id                                |
| `user_id`           | string   | Owner (Firebase uid / `dev-user`)          |
| `company`, `role`   | string   | Extracted or user-entered                  |
| `status`            | enum     | applied / interview / offer / rejected / suspicious |
| `source_email_id`   | string?  | Originating email, if imported             |
| `applied_at`        | datetime | When the application started               |
| `last_update_at`    | datetime | Drives the 7-day reminder                  |
| `suspicious`        | bool     | Flagged by the agent                       |
| `suspicious_reasons`| string[] | Why it was flagged                         |
| `notes`             | string   | Summary / free text                        |

## Design principles
- **Google-only** for AI, agents, hosting, database, and auth.
- **Degrade gracefully**: every cloud dependency has a local fallback.
- **Secrets stay server-side**: the frontend never holds privileged keys.
- **Simple first**: one Firestore collection, one agent, buildable in ~150 min.
