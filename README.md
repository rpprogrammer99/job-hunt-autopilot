# Job Hunt Autopilot

An MVP that helps you **import job-application emails, track application
status, detect suspicious recruiting emails, and get 7-day follow-up
reminders**.

Built with Google technologies end to end — Gemini (Google Gen AI SDK + ADK),
Firebase Authentication, Cloud Firestore, Firebase Hosting, Cloud Run, and
Cloud Scheduler — and designed to run **fully locally** with sample data when
no cloud credentials are present.

## Features
- 📥 **Email import** — paste or load a sample recruiting email; the agent
  extracts company, role, and status.
- 📊 **Application tracking** — dashboard with status (applied / interview /
  offer / rejected / suspicious), inline status edits, and delete.
- 🛡️ **Suspicious email detection** — flags scam signals (upfront fees, gift
  cards, SSN/bank requests, fake urgency, lookalike domains).
- ⏰ **7-day follow-up reminders** — nudges you on open applications with no
  update in a week.
- 🔐 **Firebase Auth** with a developer bypass for local work.

## Tech stack
| Layer        | Technology                                             |
|--------------|--------------------------------------------------------|
| Frontend     | React, TypeScript, Vite                                |
| Backend      | Python, FastAPI                                        |
| AI / Agent   | Gemini via Google Gen AI SDK (`google-genai`) + ADK    |
| Database     | Cloud Firestore (in-memory fallback locally)           |
| Auth         | Firebase Authentication (dev bypass locally)           |
| Hosting      | Firebase Hosting (frontend) + Cloud Run (backend)      |
| Scheduling   | Cloud Scheduler → protected Cloud Run endpoint         |

## Project structure
```
job-hunt-autopilot/
├── frontend/          # React + TS + Vite SPA
│   └── src/
│       ├── api.ts, firebase.ts, types.ts, App.tsx
│       └── components/ (ApplicationList, EmailImporter, ReminderList, StatusBadge)
├── backend/
│   ├── app/           # FastAPI app
│   │   ├── main.py, routes.py, agent.py, auth.py
│   │   ├── firestore_client.py, reminders.py, models.py, config.py
│   ├── tests/         # pytest (parsing, suspicious detection, reminders, API)
│   ├── requirements.txt, Dockerfile, pytest.ini
├── sample-data/       # sample_emails.json, sample_applications.json
├── docs/              # architecture.md, deployment.md
├── firebase.json      # Firebase Hosting config
├── .env.example       # all env vars (no secrets)
└── .gitignore
```

## Local setup & run

The app runs locally with **no cloud credentials** (DEV_MODE). It uses an
in-memory store seeded from `sample-data/` and a deterministic rule-based AI
fallback. Provide a `GOOGLE_API_KEY` to enable real Gemini parsing.

### Backend (terminal 1)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Backend runs at http://localhost:8000 — check http://localhost:8000/health.

### Frontend (terminal 2)
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at http://localhost:5173.

### Run the tests
```bash
cd backend && source .venv/bin/activate && pytest
```

## Configuration
Copy `.env.example` and fill in what you need:
- `backend/.env` — backend settings (see `DEV_MODE`, `GOOGLE_API_KEY`,
  `GOOGLE_CLOUD_PROJECT`, `SCHEDULER_TOKEN`, `CORS_ORIGINS`).
- `frontend/.env.local` — public Firebase web config + `VITE_API_BASE_URL`.

**Never commit secrets.** Service-account keys and the scheduler token must
stay server-side; only the public Firebase web config belongs in the frontend.

## API summary (prefix `/api`)
| Method | Path                          | Description                        |
|--------|-------------------------------|------------------------------------|
| GET    | `/applications`               | List the user's applications       |
| POST   | `/applications`               | Create an application              |
| PATCH  | `/applications/{id}`          | Update status/fields               |
| DELETE | `/applications/{id}`          | Delete an application              |
| POST   | `/emails/parse`               | Parse an email (no persistence)    |
| POST   | `/emails/import`              | Parse + create an application      |
| GET    | `/reminders`                  | 7-day follow-ups grouped (overdue/due today/upcoming) |
| POST   | `/reminders/recalculate`      | Recompute reminders for the user   |
| POST   | `/reminders/{id}/dismiss`     | Dismiss a reminder (preserved)     |
| POST   | `/reminders/draft`            | Gemini follow-up draft (never sent)|
| POST   | `/analyze`                    | AI analysis of one email           |
| POST   | `/scheduler/run-reminders`    | Protected daily recalculation (X-Scheduler-Token) |
| GET    | `/sample/emails`              | Bundled sample emails for the demo |

## Deployment
See [`docs/deployment.md`](docs/deployment.md). Deployment creates **billable**
Google Cloud resources and is intentionally kept separate from local dev.

## Development environment
Designed to be built and iterated in **Google Antigravity**.
