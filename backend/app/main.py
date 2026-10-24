"""FastAPI application entrypoint for Job Hunt Autopilot.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import router

settings = get_settings()

app = FastAPI(
    title="Job Hunt Autopilot API",
    version="0.1.0",
    description=(
        "Import job-application emails, track status, detect suspicious "
        "recruiting emails, and get 7-day follow-up reminders."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "dev_mode": settings.dev_mode,
        "gemini_available": settings.gemini_available,
        "firestore_available": settings.firestore_available,
    }
