"""Data access layer.

Uses Google Cloud Firestore when configured (firestore_available), otherwise
an in-memory store seeded from sample-data/. Both expose the same interface
so the rest of the app is agnostic to the backend.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from .config import SAMPLE_DATA_DIR, get_settings
from .models import Application, ApplicationStatus

APPLICATIONS = "applications"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class InMemoryStore:
    """Thread-safe in-memory applications store seeded from sample data."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._apps: dict[str, dict] = {}
        self._risk_feedback: list[dict] = []
        self._reminders: dict[str, dict] = {}
        self._seed()

    def _seed(self) -> None:
        path = SAMPLE_DATA_DIR / "sample_applications.json"
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return
        for raw in data:
            app = Application.model_validate(raw)
            if app.id is None:
                app.id = _new_id()
            self._apps[app.id] = app.model_dump(mode="json")

    def list_applications(self, user_id: str) -> list[Application]:
        with self._lock:
            items = [
                Application.model_validate(a)
                for a in self._apps.values()
                if a.get("user_id") == user_id
            ]
        items.sort(key=lambda a: a.last_update_at or _now(), reverse=True)
        return items

    def get_application(self, user_id: str, app_id: str) -> Optional[Application]:
        with self._lock:
            raw = self._apps.get(app_id)
        if raw and raw.get("user_id") == user_id:
            return Application.model_validate(raw)
        return None

    def create_application(self, app: Application) -> Application:
        with self._lock:
            if not app.id:
                app.id = _new_id()
            app.applied_at = app.applied_at or _now()
            app.last_update_at = _now()
            self._apps[app.id] = app.model_dump(mode="json")
        return app

    def update_application(
        self, user_id: str, app_id: str, changes: dict
    ) -> Optional[Application]:
        with self._lock:
            raw = self._apps.get(app_id)
            if not raw or raw.get("user_id") != user_id:
                return None
            for k, v in changes.items():
                if v is not None:
                    raw[k] = v.value if isinstance(v, ApplicationStatus) else v
            raw["last_update_at"] = _now().isoformat()
            self._apps[app_id] = raw
            return Application.model_validate(raw)

    def delete_application(self, user_id: str, app_id: str) -> bool:
        with self._lock:
            raw = self._apps.get(app_id)
            if not raw or raw.get("user_id") != user_id:
                return False
            del self._apps[app_id]
            return True

    def all_applications(self) -> list[Application]:
        with self._lock:
            return [Application.model_validate(a) for a in self._apps.values()]

    def import_keys(self, user_id: str) -> tuple[set[str], set[str]]:
        """Return (message_ids, fingerprints) already stored for the user."""
        with self._lock:
            ids: set[str] = set()
            fps: set[str] = set()
            for a in self._apps.values():
                if a.get("user_id") != user_id:
                    continue
                if a.get("source_email_id"):
                    ids.add(a["source_email_id"])
                if a.get("import_fingerprint"):
                    fps.add(a["import_fingerprint"])
            return ids, fps

    def bulk_create(self, apps: list[Application]) -> list[Application]:
        created: list[Application] = []
        with self._lock:
            for app in apps:
                if not app.id:
                    app.id = _new_id()
                app.applied_at = app.applied_at or _now()
                app.last_update_at = _now()
                self._apps[app.id] = app.model_dump(mode="json")
                created.append(app)
        return created

    def add_risk_feedback(self, user_id: str, feedback: dict) -> int:
        """Record a user's feedback on a warning. Returns total count."""
        with self._lock:
            self._risk_feedback.append({**feedback, "user_id": user_id})
            return len(self._risk_feedback)

    # ----------------------------- Reminders ----------------------------- #

    def list_reminders(self, user_id: str) -> list["ReminderRecord"]:
        from .models import ReminderRecord

        with self._lock:
            return [
                ReminderRecord.model_validate(r)
                for r in self._reminders.values()
                if r.get("user_id") == user_id
            ]

    def get_reminder(self, user_id: str, reminder_id: str):
        from .models import ReminderRecord

        with self._lock:
            raw = self._reminders.get(reminder_id)
        if raw and raw.get("user_id") == user_id:
            return ReminderRecord.model_validate(raw)
        return None

    def find_reminder_by_cycle(self, user_id: str, cycle_key: str):
        from .models import ReminderRecord

        with self._lock:
            for raw in self._reminders.values():
                if (
                    raw.get("user_id") == user_id
                    and raw.get("cycle_key") == cycle_key
                ):
                    return ReminderRecord.model_validate(raw)
        return None

    def upsert_reminder(self, reminder: "ReminderRecord") -> "ReminderRecord":
        with self._lock:
            if not reminder.id:
                reminder.id = _new_id()
                reminder.created_at = reminder.created_at or _now()
            reminder.updated_at = _now()
            self._reminders[reminder.id] = reminder.model_dump(mode="json")
            return reminder

    def delete_reminder(self, user_id: str, reminder_id: str) -> bool:
        with self._lock:
            raw = self._reminders.get(reminder_id)
            if not raw or raw.get("user_id") != user_id:
                return False
            del self._reminders[reminder_id]
            return True


class FirestoreStore:
    """Firestore-backed store. Mirrors InMemoryStore's interface."""

    def __init__(self) -> None:
        from google.cloud import firestore  # imported lazily

        settings = get_settings()
        self._db = firestore.Client(project=settings.google_cloud_project or None)
        self._col = self._db.collection(APPLICATIONS)

    def list_applications(self, user_id: str) -> list[Application]:
        docs = self._col.where("user_id", "==", user_id).stream()
        apps = [Application.model_validate({**d.to_dict(), "id": d.id}) for d in docs]
        apps.sort(key=lambda a: a.last_update_at or _now(), reverse=True)
        return apps

    def get_application(self, user_id: str, app_id: str) -> Optional[Application]:
        doc = self._col.document(app_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        if data.get("user_id") != user_id:
            return None
        return Application.model_validate({**data, "id": doc.id})

    def create_application(self, app: Application) -> Application:
        if not app.id:
            app.id = _new_id()
        app.applied_at = app.applied_at or _now()
        app.last_update_at = _now()
        self._col.document(app.id).set(app.model_dump(mode="json", exclude={"id"}))
        return app

    def update_application(
        self, user_id: str, app_id: str, changes: dict
    ) -> Optional[Application]:
        ref = self._col.document(app_id)
        doc = ref.get()
        if not doc.exists or doc.to_dict().get("user_id") != user_id:
            return None
        payload = {
            k: (v.value if isinstance(v, ApplicationStatus) else v)
            for k, v in changes.items()
            if v is not None
        }
        payload["last_update_at"] = _now().isoformat()
        ref.update(payload)
        return self.get_application(user_id, app_id)

    def delete_application(self, user_id: str, app_id: str) -> bool:
        ref = self._col.document(app_id)
        doc = ref.get()
        if not doc.exists or doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True

    def all_applications(self) -> list[Application]:
        return [
            Application.model_validate({**d.to_dict(), "id": d.id})
            for d in self._col.stream()
        ]

    def import_keys(self, user_id: str) -> tuple[set[str], set[str]]:
        ids: set[str] = set()
        fps: set[str] = set()
        for d in self._col.where("user_id", "==", user_id).stream():
            data = d.to_dict()
            if data.get("source_email_id"):
                ids.add(data["source_email_id"])
            if data.get("import_fingerprint"):
                fps.add(data["import_fingerprint"])
        return ids, fps

    def bulk_create(self, apps: list[Application]) -> list[Application]:
        created: list[Application] = []
        for app in apps:
            if not app.id:
                app.id = _new_id()
            app.applied_at = app.applied_at or _now()
            app.last_update_at = _now()
            self._col.document(app.id).set(
                app.model_dump(mode="json", exclude={"id"})
            )
            created.append(app)
        return created

    def add_risk_feedback(self, user_id: str, feedback: dict) -> int:
        col = self._db.collection("risk_feedback")
        col.document(_new_id()).set({**feedback, "user_id": user_id})
        return sum(1 for _ in col.where("user_id", "==", user_id).stream())

    # ----------------------------- Reminders ----------------------------- #

    def _reminders_col(self):
        return self._db.collection("reminders")

    def list_reminders(self, user_id: str) -> list["ReminderRecord"]:
        from .models import ReminderRecord

        return [
            ReminderRecord.model_validate({**d.to_dict(), "id": d.id})
            for d in self._reminders_col().where("user_id", "==", user_id).stream()
        ]

    def get_reminder(self, user_id: str, reminder_id: str):
        from .models import ReminderRecord

        doc = self._reminders_col().document(reminder_id).get()
        if not doc.exists or doc.to_dict().get("user_id") != user_id:
            return None
        return ReminderRecord.model_validate({**doc.to_dict(), "id": doc.id})

    def find_reminder_by_cycle(self, user_id: str, cycle_key: str):
        from .models import ReminderRecord

        docs = (
            self._reminders_col()
            .where("user_id", "==", user_id)
            .where("cycle_key", "==", cycle_key)
            .limit(1)
            .stream()
        )
        for d in docs:
            return ReminderRecord.model_validate({**d.to_dict(), "id": d.id})
        return None

    def upsert_reminder(self, reminder: "ReminderRecord") -> "ReminderRecord":
        if not reminder.id:
            reminder.id = _new_id()
            reminder.created_at = reminder.created_at or _now()
        reminder.updated_at = _now()
        self._reminders_col().document(reminder.id).set(
            reminder.model_dump(mode="json", exclude={"id"})
        )
        return reminder

    def delete_reminder(self, user_id: str, reminder_id: str) -> bool:
        ref = self._reminders_col().document(reminder_id)
        doc = ref.get()
        if not doc.exists or doc.to_dict().get("user_id") != user_id:
            return False
        ref.delete()
        return True


_store: Optional[object] = None


def get_store():
    """Return a singleton store, choosing Firestore or in-memory."""
    global _store
    if _store is not None:
        return _store
    settings = get_settings()
    if settings.firestore_available:
        try:
            _store = FirestoreStore()
            return _store
        except Exception:  # noqa: BLE001 - fall back to local store
            pass
    _store = InMemoryStore()
    return _store
