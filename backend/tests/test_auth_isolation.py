"""Firebase auth + data-isolation tests.

Scenarios required:
  * User A cannot read or modify User B's applications.
  * Unauthenticated API requests are rejected (when auth is enforced).
  * Invalid tokens are rejected.
  * Demo mode does not silently mix with real user data.

We do NOT call Firebase. Token verification is simulated by monkeypatching
`firebase_admin.auth.verify_id_token`, and auth enforcement is toggled on the
cached settings object.
"""
import sys
import types

import pytest
from fastapi.testclient import TestClient

from app import auth as auth_module
from app.auth import DEMO_USER_ID
from app.config import get_settings
from app.firestore_client import InMemoryStore
from app.main import app
from app.models import Application, ApplicationStatus

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Store-level cross-user isolation
# --------------------------------------------------------------------------- #

def _store() -> InMemoryStore:
    s = InMemoryStore()
    s._apps.clear()
    s._reminders.clear()
    return s


def test_user_a_cannot_read_user_b_application():
    s = _store()
    a = s.create_application(
        Application(user_id="userA", company="A Co", role="Eng",
                    status=ApplicationStatus.APPLIED)
    )
    # User B lists -> does not see A's application.
    assert s.list_applications("userB") == []
    # User B cannot fetch A's doc by id.
    assert s.get_application("userB", a.id) is None
    # User A can.
    assert s.get_application("userA", a.id) is not None


def test_user_a_cannot_modify_or_delete_user_b_application():
    s = _store()
    a = s.create_application(
        Application(user_id="userA", company="A Co", role="Eng",
                    status=ApplicationStatus.APPLIED)
    )
    # Update as B -> None (no cross-user write).
    assert s.update_application("userB", a.id, {"company": "hacked"}) is None
    # Delete as B -> False.
    assert s.delete_application("userB", a.id) is False
    # A's record is unchanged.
    still = s.get_application("userA", a.id)
    assert still is not None and still.company == "A Co"


def test_import_keys_are_user_scoped():
    s = _store()
    s.create_application(
        Application(user_id="userA", company="A", role="x",
                    source_email_id="<mid-a@x>", import_fingerprint="fpA")
    )
    ids_b, fps_b = s.import_keys("userB")
    assert ids_b == set() and fps_b == set()
    ids_a, fps_a = s.import_keys("userA")
    assert "<mid-a@x>" in ids_a and "fpA" in fps_a


# --------------------------------------------------------------------------- #
# Endpoint auth enforcement (REQUIRE_AUTH)
# --------------------------------------------------------------------------- #

@pytest.fixture
def enforce_auth(monkeypatch):
    """Turn on auth enforcement and reset the firebase-ready cache."""
    settings = get_settings()
    monkeypatch.setattr(settings, "require_auth", True, raising=False)
    monkeypatch.setattr(settings, "dev_mode", True, raising=False)  # auth_enforced via require_auth
    monkeypatch.setattr(auth_module, "_firebase_ready", True, raising=False)
    yield settings


def _install_fake_firebase(monkeypatch, verify):
    """Install a fake `firebase_admin.auth` module with a verify_id_token."""
    fake_auth = types.SimpleNamespace(verify_id_token=verify)
    fake_admin = types.ModuleType("firebase_admin")
    fake_admin._apps = {"default": object()}
    fake_admin.auth = fake_auth
    monkeypatch.setitem(sys.modules, "firebase_admin", fake_admin)
    monkeypatch.setitem(sys.modules, "firebase_admin.auth", fake_auth)


def test_unauthenticated_request_rejected(enforce_auth):
    r = client.get("/api/applications")  # no Authorization header
    assert r.status_code == 401


def test_invalid_token_rejected(enforce_auth, monkeypatch):
    def _reject(_token):
        raise ValueError("bad token")

    _install_fake_firebase(monkeypatch, _reject)
    r = client.get(
        "/api/applications",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert r.status_code == 401


def test_valid_token_accepted_and_scoped(enforce_auth, monkeypatch):
    def _ok(_token):
        return {"uid": "real-user-123"}

    _install_fake_firebase(monkeypatch, _ok)
    r = client.get(
        "/api/applications",
        headers={"Authorization": "Bearer good-token"},
    )
    assert r.status_code == 200
    # A brand-new real user sees no demo data.
    assert r.json() == []


def test_token_cannot_claim_demo_namespace(enforce_auth, monkeypatch):
    # A token whose uid tries to impersonate the reserved demo identity is
    # rejected, so it can never read demo data.
    def _demo_uid(_token):
        return {"uid": "demo:local-user"}

    _install_fake_firebase(monkeypatch, _demo_uid)
    r = client.get(
        "/api/applications",
        headers={"Authorization": "Bearer spoof"},
    )
    assert r.status_code == 401


# --------------------------------------------------------------------------- #
# Demo mode isolation
# --------------------------------------------------------------------------- #

def test_demo_mode_uses_reserved_identity_not_mixed_with_real():
    # Default dev settings -> demo identity.
    settings = get_settings()
    assert settings.demo_identity_allowed is True
    uid = auth_module.get_current_user_id(None)
    assert uid == DEMO_USER_ID
    assert uid.startswith("demo:")

    # The demo identity and a real UID are different namespaces in the store.
    s = _store()
    s.create_application(
        Application(user_id=DEMO_USER_ID, company="Demo", role="x")
    )
    s.create_application(
        Application(user_id="real-user-123", company="Real", role="y")
    )
    demo_apps = s.list_applications(DEMO_USER_ID)
    real_apps = s.list_applications("real-user-123")
    assert [a.company for a in demo_apps] == ["Demo"]
    assert [a.company for a in real_apps] == ["Real"]
