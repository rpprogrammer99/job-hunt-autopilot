"""API-level smoke tests using FastAPI's TestClient (dev mode, in-memory)."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_seeded_applications():
    r = client.get("/api/applications")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 3
    companies = {a["company"] for a in data}
    assert "Acme Cloud" in companies


def test_create_and_delete_application():
    r = client.post(
        "/api/applications",
        json={"company": "TestCo", "role": "QA", "status": "applied"},
    )
    assert r.status_code == 201
    app_id = r.json()["id"]

    r = client.delete(f"/api/applications/{app_id}")
    assert r.status_code == 204


def test_import_suspicious_email_flags():
    payload = {
        "id": "e-test",
        "from": "hr@g00gle-careers-secure.xyz",
        "subject": "You are hired! Pay onboarding fee",
        "body": "Send gift cards and your SSN. No interview required.",
    }
    r = client.post("/api/emails/import", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["parsed"]["suspicious"] is True
    assert body["application"]["status"] == "suspicious"


def test_scheduler_requires_token():
    assert client.post("/api/scheduler/run-reminders").status_code == 403
    ok = client.post(
        "/api/scheduler/run-reminders",
        headers={"X-Scheduler-Token": "change-me-local-dev-token"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "ok"
