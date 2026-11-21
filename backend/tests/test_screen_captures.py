"""Screen-sharing requirement and screen captures for LEFT_EXAM_SCREEN."""

import base64
import hashlib
from datetime import datetime, timedelta

from app.core.security import hash_password
from app.db.models import MonitoringEvent, ScreenCapture, Student, User

FAKE_JPEG = b"\xff\xd8\xff" + b"\x10" * 512
FAKE_JPEG_B64 = base64.b64encode(FAKE_JPEG).decode("ascii")


def _headers(client, username, password):
    token = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _admin(client):
    return _headers(client, "admin1", "adminpass123")


def _student(client):
    return _headers(client, "student1", "studentpass123")


def _active_exam(client, admin_headers, require_screen_share=True):
    exam = client.post(
        "/api/exams",
        json={
            "title": "Screen Exam",
            "description": "",
            "duration_minutes": 30,
            "require_screen_share": require_screen_share,
        },
        headers=admin_headers,
    ).json()
    client.patch(f"/api/exams/{exam['id']}/status", json={"status": "active"}, headers=admin_headers)
    return exam


def _left_screen_event(client, student_headers, exam_id, event_type="LEFT_EXAM_SCREEN"):
    session = client.post(f"/api/student/exams/{exam_id}/start", headers=student_headers).json()
    payload = {
        "session_id": session["id"],
        "event_type": event_type,
        "severity": "medium" if event_type == "LEFT_EXAM_SCREEN" else "high",
        "confidence": 1.0,
        "duration_seconds": 12.0 if event_type == "LEFT_EXAM_SCREEN" else 0.0,
        "occurrences": 1,
        "source": "browser_focus",
    }
    response = client.post("/api/monitoring/events", json=payload, headers=student_headers)
    assert response.status_code == 201, response.text
    return response.json()


def _upload(client, headers, event_id, sequence=1, image=FAKE_JPEG_B64, offset_ms=1000):
    return client.post(
        f"/api/monitoring/events/{event_id}/screen-captures",
        json={"image_base64": image, "sequence": sequence, "offset_ms": offset_ms},
        headers=headers,
    )


# --- Per-exam setting ---------------------------------------------------------


def test_exam_screen_share_requirement_defaults_on_and_can_be_changed(client, admin_user):
    admin = _admin(client)
    exam = client.post(
        "/api/exams", json={"title": "Plain", "duration_minutes": 10}, headers=admin
    ).json()
    assert exam["require_screen_share"] is True

    updated = client.put(
        f"/api/exams/{exam['id']}",
        json={"title": "Plain", "duration_minutes": 10, "require_screen_share": False},
        headers=admin,
    ).json()
    assert updated["require_screen_share"] is False


def test_student_sees_the_screen_share_requirement(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    detail = client.get(f"/api/student/exams/{exam['id']}", headers=student).json()
    listing = client.get("/api/student/exams", headers=student).json()
    assert detail["require_screen_share"] is True
    assert next(item for item in listing if item["id"] == exam["id"])["require_screen_share"] is True


def test_screen_share_stopped_event_is_accepted_as_high(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    event = _left_screen_event(client, _student(client), exam["id"], event_type="SCREEN_SHARE_STOPPED")
    assert event["event_type"] == "SCREEN_SHARE_STOPPED"
    assert event["severity"] == "high"


# --- Upload -------------------------------------------------------------------


def test_student_uploads_capture_and_admin_lists_and_views_it(client, admin_user, student_user, student_profile):
    admin = _admin(client)
    exam = _active_exam(client, admin)
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])

    response = _upload(client, student, event["id"], sequence=1, offset_ms=1200)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["sequence"] == 1
    assert body["offset_ms"] == 1200
    assert body["sha256"] == hashlib.sha256(FAKE_JPEG).hexdigest()
    assert body["size_bytes"] == len(FAKE_JPEG)

    listing = client.get(f"/api/monitoring/events/{event['id']}/screen-captures", headers=admin)
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()["items"]] == [body["id"]]

    image = client.get(f"/api/monitoring/screen-captures/{body['id']}/image", headers=admin)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    assert image.headers["cache-control"] == "no-store"
    assert image.content == FAKE_JPEG


def test_captures_are_listed_in_sequence_order(client, admin_user, student_user, student_profile):
    admin = _admin(client)
    exam = _active_exam(client, admin)
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    for sequence in (3, 1, 2):
        assert _upload(client, student, event["id"], sequence=sequence).status_code == 201

    items = client.get(f"/api/monitoring/events/{event['id']}/screen-captures", headers=admin).json()["items"]
    assert [item["sequence"] for item in items] == [1, 2, 3]


def test_at_most_six_captures_and_no_duplicate_sequence(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])

    assert _upload(client, student, event["id"], sequence=1).status_code == 201
    assert _upload(client, student, event["id"], sequence=1).status_code == 409
    for sequence in range(2, 7):
        assert _upload(client, student, event["id"], sequence=sequence).status_code == 201
    # Sequence 7 is outside the allowed range; the count limit also holds.
    assert _upload(client, student, event["id"], sequence=7).status_code == 422


def test_capture_rejected_for_another_students_event(client, admin_user, student_user, student_profile, db_session):
    exam = _active_exam(client, _admin(client))
    event = _left_screen_event(client, _student(client), exam["id"])

    other = User(username="student2", password_hash=hash_password("studentpass456"), role="student", status=True)
    db_session.add(other)
    db_session.commit()
    db_session.add(Student(user_id=other.id, student_id="STU-2002", full_name="Second Student", is_active=True))
    db_session.commit()

    response = _upload(client, _headers(client, "student2", "studentpass456"), event["id"])
    assert response.status_code == 404


def test_capture_rejected_for_other_event_types(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"], event_type="SCREEN_SHARE_STOPPED")
    assert _upload(client, student, event["id"]).status_code == 422


def test_capture_rejected_when_exam_does_not_require_screen_share(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client), require_screen_share=False)
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    assert _upload(client, student, event["id"]).status_code == 409


def test_capture_rejected_when_not_a_jpeg(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode("ascii")
    assert _upload(client, student, event["id"], image=png).status_code == 422


def test_capture_rejected_after_upload_window(client, admin_user, student_user, student_profile, db_session):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])

    row = db_session.get(MonitoringEvent, event["id"])
    row.detected_at = datetime.utcnow() - timedelta(minutes=11)
    db_session.commit()

    assert _upload(client, student, event["id"]).status_code == 409


# --- Access ---------------------------------------------------------------------


def test_students_cannot_list_or_view_captures(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    capture = _upload(client, student, event["id"]).json()

    assert client.get(f"/api/monitoring/events/{event['id']}/screen-captures", headers=student).status_code == 403
    assert client.get(f"/api/monitoring/screen-captures/{capture['id']}/image", headers=student).status_code == 403


def test_captures_of_a_voided_event_are_hidden(client, admin_user, student_user, student_profile, db_session):
    admin = _admin(client)
    exam = _active_exam(client, admin)
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    capture = _upload(client, student, event["id"]).json()

    row = db_session.get(MonitoringEvent, event["id"])
    row.voided_at = datetime.utcnow()
    db_session.commit()

    assert client.get(f"/api/monitoring/events/{event['id']}/screen-captures", headers=admin).status_code == 404
    assert client.get(f"/api/monitoring/screen-captures/{capture['id']}/image", headers=admin).status_code == 404


def test_image_falls_back_to_database_copy_when_file_is_missing(client, admin_user, student_user, student_profile, db_session):
    admin = _admin(client)
    exam = _active_exam(client, admin)
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    capture = _upload(client, student, event["id"]).json()

    row = db_session.get(ScreenCapture, capture["id"])
    row.image_path = "missing/not-here.jpg"
    db_session.commit()

    image = client.get(f"/api/monitoring/screen-captures/{capture['id']}/image", headers=admin)
    assert image.status_code == 200
    assert image.content == FAKE_JPEG


# --- Review by event (violations without a camera photo) -------------------------


def test_admin_reviews_an_event_that_has_no_camera_photo(client, admin_user, student_user, student_profile):
    from app.db.models import AdminAction

    admin = _admin(client)
    exam = _active_exam(client, admin)
    event = _left_screen_event(client, _student(client), exam["id"])
    assert event["evidence"] is None

    response = client.post(
        f"/api/monitoring/events/{event['id']}/review",
        json={"action": "CONFIRMED", "reason": "Opened a search engine"},
        headers=admin,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["event_id"] == event["id"]
    assert body["status"] == "CONFIRMED"
    assert body["action"]["action"] == "CONFIRMED"
    assert body["action"]["reason"] == "Opened a search engine"


def test_students_cannot_review_events(client, admin_user, student_user, student_profile):
    exam = _active_exam(client, _admin(client))
    student = _student(client)
    event = _left_screen_event(client, student, exam["id"])
    response = client.post(
        f"/api/monitoring/events/{event['id']}/review", json={"action": "IGNORED"}, headers=student
    )
    assert response.status_code == 403


def test_voided_event_cannot_be_reviewed(client, admin_user, student_user, student_profile, db_session):
    admin = _admin(client)
    exam = _active_exam(client, admin)
    event = _left_screen_event(client, _student(client), exam["id"])
    row = db_session.get(MonitoringEvent, event["id"])
    row.voided_at = datetime.utcnow()
    db_session.commit()

    response = client.post(
        f"/api/monitoring/events/{event['id']}/review", json={"action": "IGNORED"}, headers=admin
    )
    assert response.status_code == 404


# --- Bulk review ---------------------------------------------------------------


def _events_in_one_session(client, admin, count):
    student = _student(client)
    exam = _active_exam(client, admin, require_screen_share=False)
    session = client.post(f"/api/student/exams/{exam['id']}/start", headers=student).json()
    ids = []
    for _ in range(count):
        response = client.post(
            "/api/monitoring/events",
            json={
                "session_id": session["id"],
                "event_type": "LEFT_EXAM_SCREEN",
                "severity": "medium",
                "confidence": 1.0,
                "duration_seconds": 12.0,
                "occurrences": 1,
                "source": "browser_focus",
            },
            headers=student,
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    return ids


def test_bulk_review_records_one_audit_row_per_event(client, admin_user, student_user, student_profile, db_session):
    from app.db.models import AdminAction

    admin = _admin(client)
    ids = _events_in_one_session(client, admin, 3)

    response = client.post(
        "/api/monitoring/events/bulk-review",
        json={"event_ids": ids, "action": "IGNORED", "reason": "  False positive: lighting  "},
        headers=admin,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["event_id"] for item in body["reviewed"]] == ids
    assert all(item["status"] == "IGNORED" for item in body["reviewed"])
    assert body["skipped"] == []

    db_session.expire_all()
    actions = db_session.query(AdminAction).filter(AdminAction.event_id.in_(ids)).all()
    assert len(actions) == 3
    assert {a.reason for a in actions} == {"False positive: lighting"}
    assert all(db_session.get(MonitoringEvent, i).status == "IGNORED" for i in ids)


def test_bulk_review_skips_voided_and_missing_events(client, admin_user, student_user, student_profile, db_session):
    admin = _admin(client)
    ids = _events_in_one_session(client, admin, 2)
    row = db_session.get(MonitoringEvent, ids[1])
    row.voided_at = datetime.utcnow()
    db_session.commit()

    response = client.post(
        "/api/monitoring/events/bulk-review",
        json={"event_ids": [ids[0], ids[1], 999999], "action": "CONFIRMED", "reason": "Seen on evidence"},
        headers=admin,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["event_id"] for item in body["reviewed"]] == [ids[0]]
    assert body["skipped"] == [
        {"event_id": ids[1], "reason": "not_found"},
        {"event_id": 999999, "reason": "not_found"},
    ]
    db_session.expire_all()
    assert db_session.get(MonitoringEvent, ids[1]).status == "PENDING_REVIEW"


def test_bulk_review_ignores_duplicate_ids(client, admin_user, student_user, student_profile, db_session):
    from app.db.models import AdminAction

    admin = _admin(client)
    [event_id] = _events_in_one_session(client, admin, 1)
    response = client.post(
        "/api/monitoring/events/bulk-review",
        json={"event_ids": [event_id, event_id], "action": "IGNORED", "reason": "Duplicate"},
        headers=admin,
    )
    assert response.status_code == 200
    assert len(response.json()["reviewed"]) == 1
    assert db_session.query(AdminAction).filter(AdminAction.event_id == event_id).count() == 1


def test_bulk_review_remark_is_optional(client, admin_user, student_user, student_profile, db_session):
    from app.db.models import AdminAction

    admin = _admin(client)
    ids = _events_in_one_session(client, admin, 2)
    for event_id, body in zip(ids, (
        {"event_ids": [ids[0]], "action": "IGNORED"},
        {"event_ids": [ids[1]], "action": "IGNORED", "reason": "   "},
    )):
        response = client.post("/api/monitoring/events/bulk-review", json=body, headers=admin)
        assert response.status_code == 200, response.text
        action = db_session.query(AdminAction).filter(AdminAction.event_id == event_id).one()
        assert action.reason is None


def test_bulk_review_limits_the_batch_size(client, admin_user):
    admin = _admin(client)
    for ids in ([], list(range(1, 102))):
        response = client.post(
            "/api/monitoring/events/bulk-review",
            json={"event_ids": ids, "action": "IGNORED", "reason": "x"},
            headers=admin,
        )
        assert response.status_code == 422


def test_bulk_review_rejects_unknown_decisions(client, admin_user, student_user, student_profile):
    admin = _admin(client)
    ids = _events_in_one_session(client, admin, 1)
    response = client.post(
        "/api/monitoring/events/bulk-review",
        json={"event_ids": ids, "action": "CANCEL_EXAM", "reason": "x"},
        headers=admin,
    )
    assert response.status_code == 422


def test_students_cannot_bulk_review(client, admin_user, student_user, student_profile):
    ids = _events_in_one_session(client, _admin(client), 1)
    response = client.post(
        "/api/monitoring/events/bulk-review",
        json={"event_ids": ids, "action": "IGNORED", "reason": "x"},
        headers=_student(client),
    )
    assert response.status_code == 403
