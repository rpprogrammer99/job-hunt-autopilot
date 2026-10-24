"""Local CLI to recalculate follow-up reminders.

For local development you can run this instead of standing up Cloud Scheduler:

    python -m recalculate_reminders              # all users with applications
    python -m recalculate_reminders --user dev-user

It never sends email; it only reconciles the persisted reminder records.
"""
from __future__ import annotations

import argparse

from app import reminder_service
from app.firestore_client import get_store


def main() -> None:
    parser = argparse.ArgumentParser(description="Recalculate follow-up reminders.")
    parser.add_argument(
        "--user",
        default=None,
        help="Recalculate for a single user id (default: all users).",
    )
    args = parser.parse_args()

    store = get_store()
    if args.user:
        user_ids = [args.user]
    else:
        user_ids = sorted({a.user_id for a in store.all_applications()})

    if not user_ids:
        print("No users / applications found.")
        return

    for uid in user_ids:
        res = reminder_service.recalculate(store, uid)
        print(
            f"user={uid} created={res.created} updated={res.updated} "
            f"obsoleted={res.obsoleted} active={res.total_active}"
        )


if __name__ == "__main__":
    main()
