# Deployment Notes

> ⚠️ These steps create **billable** Google Cloud resources. Do not run them
> without explicit approval. The MVP runs fully locally without any of this.

## Prerequisites
- A Google Cloud project with billing enabled.
- `gcloud` CLI and Firebase CLI installed and authenticated.
- APIs enabled: Firestore, Cloud Run, Cloud Build, Vertex AI (if using Vertex),
  Cloud Scheduler, Identity Toolkit (Firebase Auth).

## 1. Firestore
```bash
gcloud firestore databases create --location=nam5   # or your region
```
The app uses a single `applications` collection; no schema setup needed.

## 2. Firebase Authentication
- In the Firebase console, enable the **Google** sign-in provider.
- Copy the web app config into `frontend/.env.local` (these values are public):
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
- Set `VITE_DEV_MODE=false` to require real sign-in.

## 3. Backend → Cloud Run
Build from the repo root (the Dockerfile copies `backend/app` and `sample-data`):
```bash
gcloud run deploy jha-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars DEV_MODE=false,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,\
GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_LOCATION=us-central1,\
CORS_ORIGINS=https://$PROJECT_ID.web.app
```
Store the scheduler token as a secret and inject it:
```bash
echo -n "$(openssl rand -hex 24)" | gcloud secrets create jha-scheduler-token --data-file=-
gcloud run services update jha-backend \
  --update-secrets SCHEDULER_TOKEN=jha-scheduler-token:latest
```
Grant the Cloud Run service account **Firestore User** and (if using Vertex)
**Vertex AI User** roles. Do not mount service-account JSON files into the
image; use the attached service identity.

## 4. Frontend → Firebase Hosting
Point the frontend at the deployed backend, then build and deploy:
```bash
# frontend/.env.local
#   VITE_API_BASE_URL=https://jha-backend-xxxx.a.run.app
cd frontend && npm run build && cd ..
firebase deploy --only hosting
```
`firebase.json` is already configured to serve `frontend/dist` as an SPA.

## 5. Scheduled reminder recalculation

Follow-up reminders are **stateful**: a daily job recalculates them so that
"upcoming" reminders become "due today" / "overdue" as time passes. No email is
ever sent — the job only reconciles reminder records; users copy/approve any
drafted message themselves.

### Local development
Recalculate without any cloud infrastructure:
```bash
cd backend && source .venv/bin/activate
python -m recalculate_reminders            # all users
python -m recalculate_reminders --user dev-user
```
Or hit the per-user endpoint while the server runs:
```bash
curl -X POST http://localhost:8000/api/reminders/recalculate
```

### Protected Cloud Run endpoint
`POST /api/scheduler/run-reminders` recalculates reminders for every user. It is
protected by a shared secret sent in the `X-Scheduler-Token` header and rejects
unauthorized requests with HTTP 403. Store the secret in Secret Manager and
inject it into Cloud Run (see step 3):
```bash
echo -n "$(openssl rand -hex 24)" | gcloud secrets create jha-scheduler-token --data-file=-
gcloud run services update jha-backend \
  --update-secrets SCHEDULER_TOKEN=jha-scheduler-token:latest
```

### Cloud Scheduler → daily call
```bash
# Fetch the token value to pass as a header (keep it secret; do not log it).
TOKEN="$(gcloud secrets versions access latest --secret=jha-scheduler-token)"

gcloud scheduler jobs create http jha-daily-reminders \
  --schedule="0 9 * * *" \            # every day at 09:00
  --time-zone="Etc/UTC" \
  --uri="https://jha-backend-xxxx.a.run.app/api/scheduler/run-reminders" \
  --http-method=POST \
  --headers="X-Scheduler-Token=${TOKEN}" \
  --location=us-central1
```

### Securing the scheduled request
Two complementary layers are recommended in production:

1. **Shared-secret header (implemented):** `X-Scheduler-Token` must match
   `SCHEDULER_TOKEN`. Requests without the correct token get HTTP 403.
2. **Cloud Run IAM + OIDC (recommended on top):** deploy the backend WITHOUT
   `--allow-unauthenticated`, give the scheduler a dedicated service account
   with the `roles/run.invoker` role, and have Cloud Scheduler send a signed
   OIDC token so only that identity can invoke the endpoint:
   ```bash
   gcloud scheduler jobs create http jha-daily-reminders \
     --schedule="0 9 * * *" \
     --uri="https://jha-backend-xxxx.a.run.app/api/scheduler/run-reminders" \
     --http-method=POST \
     --oidc-service-account-email=jha-scheduler@$PROJECT_ID.iam.gserviceaccount.com \
     --oidc-token-audience="https://jha-backend-xxxx.a.run.app" \
     --headers="X-Scheduler-Token=${TOKEN}" \
     --location=us-central1
   ```
   With both layers, an attacker needs both the IAM identity and the secret
   token. Rotate the token periodically via a new Secret Manager version.

## Security checklist
- [ ] `SCHEDULER_TOKEN` stored in Secret Manager, never committed.
- [ ] Scheduler endpoint rejects requests without a valid token (HTTP 403).
- [ ] (Recommended) Cloud Run requires IAM auth; scheduler uses an OIDC token.
- [ ] The scheduled job never sends email — it only recalculates reminders.
- [ ] No service-account JSON in the repo or the frontend bundle.
- [ ] `CORS_ORIGINS` restricted to the Hosting domain in production.
- [ ] `DEV_MODE=false` in Cloud Run so auth is enforced.
- [ ] Firestore security rules restrict documents to their `user_id`.
