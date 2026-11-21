"""Effective (display) status of an exam session.

Sessions expire lazily: a session stays stored as "in_progress" until a
request from the student touches it after its deadline (see
student_exams.py::_sync_expiry). A student who simply closed the browser
therefore keeps an "in_progress" row indefinitely.

Admin read endpoints must not mutate state (see admin_dashboard.py), so
instead of rewriting the row they report what the session effectively is:
past its deadline, an "in_progress" session is "expired", ended at its
deadline -- exactly what _sync_expiry would store when it next runs.
"""

from datetime import datetime, timedelta


def session_deadline(started_at: datetime, duration_minutes: int) -> datetime:
    return started_at + timedelta(minutes=duration_minutes)


def is_overdue(
    status: str, started_at: datetime, duration_minutes: int, now: datetime | None = None
) -> bool:
    if status != "in_progress" or started_at is None or duration_minutes is None:
        return False
    return (now or datetime.utcnow()) >= session_deadline(started_at, duration_minutes)


def effective_session_status(
    status: str, started_at: datetime, duration_minutes: int, now: datetime | None = None
) -> str:
    return "expired" if is_overdue(status, started_at, duration_minutes, now) else status


def effective_ended_at(
    status: str,
    started_at: datetime,
    ended_at: datetime | None,
    duration_minutes: int,
    now: datetime | None = None,
) -> datetime | None:
    if ended_at is None and is_overdue(status, started_at, duration_minutes, now):
        return session_deadline(started_at, duration_minutes)
    return ended_at
