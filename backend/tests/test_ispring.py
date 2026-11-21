import io
import zipfile

from app.core.config import settings


def _auth_headers(client, username: str, password: str) -> dict:
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _scorm_zip(launch_file: str = "index.html") -> bytes:
    manifest = f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
 xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <organizations default="ORG"><organization identifier="ORG">
    <item identifier="ITEM" identifierref="RES"><title>Quiz</title></item>
  </organization></organizations>
  <resources><resource identifier="RES" type="webcontent" adlcp:scormtype="sco"
    href="{launch_file}"><file href="{launch_file}"/></resource></resources>
</manifest>"""
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("imsmanifest.xml", manifest)
        archive.writestr(launch_file, "<html><head></head><body>iSpring quiz</body></html>")
    return stream.getvalue()


def _create_ispring_exam(client, admin_headers):
    return client.post(
        "/api/exams",
        json={
            "title": "iSpring Exam",
            "duration_minutes": 30,
            "content_type": "ispring",
        },
        headers=admin_headers,
    ).json()


def _upload(client, admin_headers, exam_id, content=None):
    return client.post(
        f"/api/exams/{exam_id}/ispring-package",
        files={"package_file": ("quiz.zip", content or _scorm_zip(), "application/zip")},
        headers=admin_headers,
    )


def test_ispring_exam_requires_valid_package_before_activation(client, admin_user):
    headers = _auth_headers(client, "admin1", "adminpass123")
    exam = _create_ispring_exam(client, headers)
    response = client.patch(
        f"/api/exams/{exam['id']}/status",
        json={"status": "active"},
        headers=headers,
    )
    assert response.status_code == 409


def test_admin_uploads_valid_scorm_package(client, admin_user):
    headers = _auth_headers(client, "admin1", "adminpass123")
    exam = _create_ispring_exam(client, headers)
    response = _upload(client, headers, exam["id"])
    assert response.status_code == 201
    assert response.json()["version"] == 1
    assert len(response.json()["checksum_sha256"]) == 64

    refreshed = client.get(f"/api/exams/{exam['id']}", headers=headers).json()
    assert refreshed["ispring_package_uploaded"] is True
    assert refreshed["ispring_package_version"] == 1


def test_invalid_or_unsafe_package_is_rejected(client, admin_user):
    headers = _auth_headers(client, "admin1", "adminpass123")
    exam = _create_ispring_exam(client, headers)
    invalid = _upload(client, headers, exam["id"], b"not-a-zip")
    assert invalid.status_code == 422

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("../unsafe.html", "bad")
        archive.writestr("imsmanifest.xml", "<manifest/>")
    unsafe = _upload(client, headers, exam["id"], stream.getvalue())
    assert unsafe.status_code == 422


def test_student_launches_and_finishes_ispring_attempt(
    client, admin_user, student_user, student_profile
):
    admin_headers = _auth_headers(client, "admin1", "adminpass123")
    exam = _create_ispring_exam(client, admin_headers)
    assert _upload(client, admin_headers, exam["id"]).status_code == 201
    assert client.patch(
        f"/api/exams/{exam['id']}/status",
        json={"status": "active"},
        headers=admin_headers,
    ).status_code == 200

    student_headers = _auth_headers(client, "student1", "studentpass123")
    session = client.post(
        f"/api/student/exams/{exam['id']}/start", headers=student_headers
    ).json()
    origin = settings.cors_origins.split(",")[0].strip()
    launch = client.get(
        f"/api/student/sessions/{session['id']}/ispring-launch",
        headers={**student_headers, "Origin": origin},
    )
    assert launch.status_code == 200
    launch_body = launch.json()
    content = client.get(launch_body["launch_url"])
    assert content.status_code == 200
    assert "window.API" in content.text
    assert student_profile.student_id in content.text

    values = {
        "cmi.core.lesson_status": "passed",
        "cmi.core.score.raw": "8",
        "cmi.core.score.min": "0",
        "cmi.core.score.max": "10",
        "cmi.suspend_data": "resume-data",
    }
    commit = client.put(
        f"/api/student/sessions/{session['id']}/scorm-state",
        json={"values": values},
        headers=student_headers,
    )
    assert commit.status_code == 200
    finish = client.post(
        f"/api/student/sessions/{session['id']}/scorm-finish",
        json={"values": values},
        headers=student_headers,
    )
    assert finish.status_code == 200
    assert finish.json()["score"] == 80

    saved_session = client.get(
        f"/api/student/sessions/{session['id']}", headers=student_headers
    ).json()
    assert saved_session["status"] == "submitted"
    assert saved_session["score"] == 80
