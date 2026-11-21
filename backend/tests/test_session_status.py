from datetime import datetime, timedelta

from app.services.session_status import effective_ended_at, effective_session_status

STARTED = datetime(2026, 1, 1, 10, 0, 0)


def test_in_progress_before_deadline_is_unchanged():
    now = STARTED + timedelta(minutes=30)
    assert effective_session_status("in_progress", STARTED, 60, now) == "in_progress"
    assert effective_ended_at("in_progress", STARTED, None, 60, now) is None


def test_in_progress_past_deadline_reports_expired_at_deadline():
    now = STARTED + timedelta(days=30)
    assert effective_session_status("in_progress", STARTED, 60, now) == "expired"
    assert effective_ended_at("in_progress", STARTED, None, 60, now) == STARTED + timedelta(
        minutes=60
    )


def test_deadline_instant_counts_as_expired_like_sync_expiry():
    now = STARTED + timedelta(minutes=60)
    assert effective_session_status("in_progress", STARTED, 60, now) == "expired"


def test_finished_sessions_are_never_rewritten():
    now = STARTED + timedelta(days=30)
    ended = STARTED + timedelta(minutes=5)
    for status in ("submitted", "cancelled", "expired"):
        assert effective_session_status(status, STARTED, 60, now) == status
        assert effective_ended_at(status, STARTED, ended, 60, now) == ended
