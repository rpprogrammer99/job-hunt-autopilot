"""Authentication dependency.

Verifies Firebase Authentication ID tokens via firebase-admin and derives the
authenticated user id SOLELY from the verified token — never from a value
supplied by the client body/query. This is the single source of the owner UID
used to scope every query.

Modes:
  * auth_enforced (production / require_auth): a valid Firebase ID token is
    mandatory. There is no bypass.
  * local dev (dev_mode and not require_auth): a reserved demo identity is
    used so the app is runnable offline. The demo UID lives in its own
    namespace and can never collide with a real Firebase UID.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from .config import get_settings

# Reserved demo identity. The "demo:" prefix cannot be produced by Firebase
# (its UIDs never contain a colon in this position for our usage), so demo data
# can never be read or written under a real user's UID and vice-versa.
DEMO_USER_ID = "demo:local-user"
# Backwards-compatible alias used by older code/tests.
DEV_USER_ID = DEMO_USER_ID

_firebase_ready: Optional[bool] = None


def _ensure_firebase() -> bool:
    """Initialize firebase-admin once. Returns True if available."""
    global _firebase_ready
    if _firebase_ready is not None:
        return _firebase_ready
    try:
        import firebase_admin

        if not firebase_admin._apps:
            # Uses GOOGLE_APPLICATION_CREDENTIALS / ADC. No secrets in code.
            firebase_admin.initialize_app()
        _firebase_ready = True
    except Exception:  # noqa: BLE001
        _firebase_ready = False
    return _firebase_ready


def _verify_token(authorization: Optional[str]) -> str:
    """Verify a Bearer Firebase ID token and return its UID. Raises 401/503."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
        )
    if not _ensure_firebase():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth backend unavailable",
        )
    try:
        from firebase_admin import auth as fb_auth

        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:  # noqa: BLE001
        # Do not echo token contents in the error.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    uid = decoded.get("uid")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing uid",
        )
    # A verified Firebase UID must never masquerade as the reserved demo id.
    if str(uid).startswith("demo:"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid subject",
        )
    return str(uid)


def get_current_user_id(
    authorization: Optional[str] = Header(default=None),
) -> str:
    """FastAPI dependency returning the authenticated user's id.

    - When auth is enforced: requires a valid Firebase ID token.
    - In local dev (demo allowed): returns the reserved demo identity.
    The returned id is the ONLY trusted owner UID; callers must scope all
    queries by it.
    """
    settings = get_settings()
    if settings.auth_enforced:
        return _verify_token(authorization)
    # Local dev with demo identity allowed.
    if settings.demo_identity_allowed:
        # If a caller DID send a token, still verify it so real users in dev
        # don't accidentally land in the demo namespace.
        if authorization:
            try:
                return _verify_token(authorization)
            except HTTPException:
                # Fall back to demo identity only for clearly-absent/invalid
                # tokens in dev. (Kept permissive solely for local demo.)
                pass
        return DEMO_USER_ID
    # Safety net: if neither condition holds, require auth.
    return _verify_token(authorization)


# Alias expressing intent at call sites that always require a real user.
require_auth = get_current_user_id


def verify_scheduler_token(
    x_scheduler_token: Optional[str] = Header(default=None),
) -> None:
    """Protects the scheduler endpoint with a shared secret token."""
    settings = get_settings()
    if not x_scheduler_token or x_scheduler_token != settings.scheduler_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid scheduler token",
        )


# Convenience export for routes.
CurrentUser = Depends(get_current_user_id)
