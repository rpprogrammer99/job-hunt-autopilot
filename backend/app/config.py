"""Application configuration loaded from environment variables.

All cloud integrations are optional. When credentials/keys are absent the
app runs in DEV_MODE with an in-memory store and rule-based AI fallback so
it is fully usable without any billable Google Cloud resources.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root = two levels up from this file (backend/app/config.py -> repo root).
REPO_ROOT = Path(__file__).resolve().parents[2]
# Allow containers to override where bundled sample data lives.
SAMPLE_DATA_DIR = Path(os.environ.get("SAMPLE_DATA_DIR", REPO_ROOT / "sample-data"))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(REPO_ROOT / "backend" / ".env"),
            str(REPO_ROOT / ".env"),
            str(REPO_ROOT / "backend" / ".env.production"),
            str(REPO_ROOT / ".env.production"),
            ".env",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    dev_mode: bool = True

    # When true, a valid Firebase ID token is REQUIRED on every protected
    # request and the demo/dev bypass is disabled entirely. Set true in
    # production. When false AND dev_mode is true, the reserved demo identity
    # is used so demo data stays in its own namespace.
    require_auth: bool = False

    # Google Cloud / Firestore
    google_cloud_project: str = ""
    google_application_credentials: str = ""

    # Google Gen AI SDK
    google_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    google_genai_use_vertexai: bool = False
    google_cloud_location: str = "us-central1"

    # Scheduler protection
    scheduler_token: str = "change-me-local-dev-token"

    # Email import limits (bytes). Default 10 MiB. Configurable via env.
    max_upload_bytes: int = 10 * 1024 * 1024
    # Max number of messages accepted in a single import request.
    max_import_messages: int = 5000

    # CORS
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gemini_available(self) -> bool:
        """True if we have enough config to call Gemini."""
        if self.google_genai_use_vertexai:
            return bool(self.google_cloud_project)
        return bool(self.google_api_key)

    @property
    def firestore_available(self) -> bool:
        """True if we should attempt real Firestore (not dev mode)."""
        return not self.dev_mode and bool(self.google_cloud_project)

    @property
    def auth_enforced(self) -> bool:
        """True when a valid Firebase ID token is mandatory.

        Enforced when require_auth is set OR whenever we are not in local
        dev_mode. This guarantees production never silently accepts the demo
        identity.
        """
        return self.require_auth or not self.dev_mode

    @property
    def demo_identity_allowed(self) -> bool:
        """The demo identity bypass is only allowed in local dev mode and when
        auth is not explicitly required."""
        return self.dev_mode and not self.require_auth


@lru_cache
def get_settings() -> Settings:
    return Settings()
