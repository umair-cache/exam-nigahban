"""One-command database setup for a fresh local install.

Run from the backend folder, after creating the empty database named in
backend/.env:

    python setup_database.py

It runs, in order, the same steps the deployment build uses (build.sh):
  1. create every table and seed the monitoring rules  (init_db.py)
  2. apply the column migrations; each one skips what already exists
  3. load the demo admin, students and exams          (app/cli/seed_demo_data.py)
  4. on a brand-new database only, make the demo admin the system
     administrator, so every admin page (including Voided Records) can be
     tried; an existing database's accounts are never changed

Safe to run again: existing tables, columns, rules and demo records are kept.
"""

import sys

import migrate_add_ispring_columns
import migrate_add_screen_share_columns
import migrate_add_user_columns
import migrate_add_void_columns
from app.cli import seed_demo_data
from app.db.models import User
from app.db.session import SessionLocal
from init_db import init_database


def _admin_exists() -> bool:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.role == "admin").first() is not None
    finally:
        db.close()


def _ensure_system_admin() -> str:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.is_system_admin.is_(True)).first():
            return "System administrator already set; left unchanged."
        admin = (
            db.query(User)
            .filter(User.username == seed_demo_data.ADMIN_ACCOUNT["username"], User.role == "admin")
            .first()
        )
        if admin is None:
            return "Demo admin not found; no system administrator set."
        admin.is_system_admin = True
        db.commit()
        return f"'{admin.username}' is now the system administrator."
    finally:
        db.close()


def main() -> int:
    # Windows consoles may not support every character a step prints.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    print("[1/4] Creating tables and monitoring rules")
    init_database()

    print("[2/4] Applying migrations")
    for step in (migrate_add_user_columns.main, migrate_add_void_columns.main):
        if step() != 0:
            print("Migration failed; stopping.")
            return 1
    migrate_add_ispring_columns.migrate()
    migrate_add_screen_share_columns.migrate()

    print("[3/4] Loading demo data")
    fresh_install = not _admin_exists()
    if seed_demo_data.main() != 0:
        print("Loading demo data failed; see the error above.")
        return 1

    if fresh_install:
        print("[4/4] " + _ensure_system_admin())
    else:
        print("[4/4] Existing admin accounts found; system administrator left unchanged.")
    print("\nSetup complete. Start the API with:  uvicorn app.main:app --reload")
    return 0


if __name__ == "__main__":
    sys.exit(main())
