from __future__ import annotations

import json
import mimetypes
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

import jwt
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.routes.student_exams import (
    _get_owned_session_or_404,
    _reject_if_blocked,
    _sync_expiry,
    get_current_student,
)
from app.core.config import settings
from app.core.logging import log_event
from app.db.models import Exam, ExamSession, IspringAttempt, IspringPackage, Student, User
from app.db.session import get_db
from app.schemas.ispring import (
    IspringLaunchResponse,
    IspringPackageResponse,
    ScormFinishResponse,
    ScormStateRequest,
    ScormStateResponse,
)
from app.services.ispring_packages import (
    IspringPackageValidationError,
    MAX_ARCHIVE_BYTES,
    read_package_member,
    validate_scorm_package,
)

router = APIRouter(prefix="/api", tags=["ispring"])


def _package_response(package: IspringPackage) -> IspringPackageResponse:
    return IspringPackageResponse(
        id=package.id,
        exam_id=package.exam_id,
        version=package.version,
        original_filename=package.original_filename,
        checksum_sha256=package.checksum_sha256,
        launch_file=package.launch_file,
        uploaded_at=package.uploaded_at,
        is_active=package.is_active,
    )


@router.post(
    "/exams/{exam_id}/ispring-package",
    response_model=IspringPackageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_ispring_package(
    exam_id: int,
    package_file: UploadFile = File(...),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> IspringPackageResponse:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam.content_type != "ispring":
        raise HTTPException(
            status_code=409,
            detail="Change the exam content type to iSpring before uploading a package",
        )
    if exam.status == "active":
        raise HTTPException(
            status_code=409,
            detail="Deactivate the exam before replacing its iSpring package",
        )
    if (
        db.query(ExamSession).filter(ExamSession.exam_id == exam.id).first()
        is not None
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "The quiz cannot be replaced after an attempt has started. "
                "Create a new exam to publish a revised quiz."
            ),
        )
    filename = package_file.filename or "quiz.zip"
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="An iSpring SCORM ZIP file is required")

    # Read one byte beyond the limit so an oversized upload is rejected
    # without first loading an arbitrarily large request into memory.
    archive_bytes = await package_file.read(MAX_ARCHIVE_BYTES + 1)
    try:
        validated = validate_scorm_package(archive_bytes)
    except IspringPackageValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    next_version = (
        db.query(func.max(IspringPackage.version))
        .filter(IspringPackage.exam_id == exam.id)
        .scalar()
        or 0
    ) + 1
    db.query(IspringPackage).filter(
        IspringPackage.exam_id == exam.id,
        IspringPackage.is_active.is_(True),
    ).update({IspringPackage.is_active: False}, synchronize_session=False)
    package = IspringPackage(
        exam_id=exam.id,
        version=next_version,
        original_filename=filename[:255],
        launch_file=validated.launch_file,
        checksum_sha256=validated.checksum_sha256,
        archive_bytes=validated.archive_bytes,
        is_active=True,
        uploaded_by_user_id=admin.id,
    )
    db.add(package)
    db.commit()
    db.refresh(package)
    log_event(
        "ispring.package.uploaded",
        exam_id=exam.id,
        package_id=package.id,
        version=package.version,
        checksum=package.checksum_sha256,
        admin_id=admin.id,
    )
    return _package_response(package)


def _trusted_parent_origin(request: Request) -> str:
    configured = {
        origin.strip().rstrip("/")
        for origin in settings.cors_origins.split(",")
        if origin.strip()
    }
    supplied = request.headers.get("origin", "").rstrip("/")
    if supplied in configured:
        return supplied
    if settings.environment != "production" and configured:
        return sorted(configured)[0]
    raise HTTPException(status_code=400, detail="A trusted application origin is required")


def _create_launch_token(
    session_id: int, package_id: int, parent_origin: str, nonce: str, expires_at: datetime
) -> str:
    return jwt.encode(
        {
            "purpose": "ispring_launch",
            "session_id": session_id,
            "package_id": package_id,
            "parent_origin": parent_origin,
            "nonce": nonce,
            "exp": expires_at.replace(tzinfo=timezone.utc),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def _decode_launch_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired launch link") from exc
    if payload.get("purpose") != "ispring_launch":
        raise HTTPException(status_code=401, detail="Invalid launch link")
    return payload


@router.get(
    "/student/sessions/{session_id}/ispring-launch",
    response_model=IspringLaunchResponse,
)
def get_ispring_launch(
    session_id: int,
    request: Request,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
) -> IspringLaunchResponse:
    session_row = _get_owned_session_or_404(session_id, student, db)
    exam = db.get(Exam, session_row.exam_id)
    session_row = _sync_expiry(session_row, exam, db)
    if session_row.status != "in_progress" or exam.content_type != "ispring":
        raise HTTPException(status_code=409, detail="This iSpring session is not active")
    if session_row.ispring_package_id is None:
        raise HTTPException(status_code=409, detail="No iSpring package is assigned")

    package = db.get(IspringPackage, session_row.ispring_package_id)
    if package is None:
        raise HTTPException(status_code=409, detail="The assigned iSpring package is unavailable")

    parent_origin = _trusted_parent_origin(request)
    base_url = str(request.base_url).rstrip("/")
    content_origin = f"{urlparse(base_url).scheme}://{urlparse(base_url).netloc}"
    if content_origin == parent_origin:
        raise HTTPException(
            status_code=409,
            detail=(
                "iSpring content must be served from a separate API/content origin "
                "so uploaded quiz code cannot access the application login token"
            ),
        )
    nonce = secrets.token_urlsafe(24)
    deadline = session_row.started_at + timedelta(minutes=exam.duration_minutes, seconds=300)
    token = _create_launch_token(session_row.id, package.id, parent_origin, nonce, deadline)
    launch_url = (
        f"{base_url}/api/ispring/content/{quote(token, safe='')}/"
        f"{quote(package.launch_file, safe='/')}"
    )
    return IspringLaunchResponse(
        launch_url=launch_url,
        message_nonce=nonce,
        content_origin=content_origin,
    )


def _attempt_values(attempt: IspringAttempt | None, student: Student) -> dict[str, str]:
    values: dict[str, str] = {}
    if attempt is not None:
        try:
            loaded = json.loads(attempt.cmi_data_json)
            if isinstance(loaded, dict):
                values.update({str(k): str(v) for k, v in loaded.items()})
        except (TypeError, ValueError):
            pass
    values["cmi.core.student_id"] = student.student_id
    values["cmi.core.student_name"] = student.full_name
    values["cmi.core.credit"] = "credit"
    values["cmi.core.lesson_mode"] = "normal"
    values["cmi.core.entry"] = "resume" if attempt is not None else "ab-initio"
    values.setdefault("cmi.core.total_time", "0000:00:00")
    values.setdefault("cmi.launch_data", "")
    values["cmi.core._children"] = (
        "student_id,student_name,lesson_location,credit,lesson_status,entry,"
        "score,total_time,lesson_mode,exit,session_time"
    )
    values["cmi.core.score._children"] = "raw,min,max"
    values["cmi.interactions._children"] = (
        "id,objectives,time,type,correct_responses,weighting,student_response,result,latency"
    )
    values["cmi.objectives._children"] = "id,score,status"
    values.setdefault("cmi.core.lesson_status", "not attempted")
    return values


def _bridge_script(values: dict[str, str], parent_origin: str, nonce: str) -> str:
    initial_json = json.dumps(values).replace("</", "<\\/")
    origin_json = json.dumps(parent_origin)
    nonce_json = json.dumps(nonce)
    return f"""<script>
(function () {{
  'use strict';
  var values = {initial_json};
  var writable = {{
    'cmi.core.lesson_status':1,'cmi.core.score.raw':1,'cmi.core.score.min':1,
    'cmi.core.score.max':1,'cmi.core.lesson_location':1,'cmi.core.session_time':1,
    'cmi.core.exit':1,'cmi.suspend_data':1,'cmi.comments':1
  }};
  function canWrite(name) {{
    return !!writable[name] || name.indexOf('cmi.interactions.') === 0 ||
      name.indexOf('cmi.objectives.') === 0 || name.indexOf('cmi.student_preference.') === 0;
  }}
  function countPrefix(prefix) {{
    var indexes = {{}};
    Object.keys(values).forEach(function (key) {{
      if (key.indexOf(prefix) !== 0) return;
      var index = key.slice(prefix.length).split('.')[0];
      if (/^\\d+$/.test(index)) indexes[index] = 1;
    }});
    return String(Object.keys(indexes).length);
  }}
  var initialized = false, finished = false, lastError = '0';
  function send(type) {{
    var state = {{}};
    Object.keys(values).forEach(function (key) {{
      if (canWrite(key)) state[key] = String(values[key]);
    }});
    window.parent.postMessage({{
      source:'exam-nigahban-ispring', nonce:{nonce_json}, type:type, values:state
    }}, {origin_json});
  }}
  window.API = {{
    LMSInitialize:function () {{
      if (finished) {{ lastError='101'; return 'false'; }}
      initialized=true; lastError='0'; send('initialized'); return 'true';
    }},
    LMSFinish:function () {{
      if (!initialized || finished) {{ lastError='301'; return 'false'; }}
      send('finish'); finished=true; initialized=false; lastError='0'; return 'true';
    }},
    LMSGetValue:function (name) {{
      if (!initialized) {{ lastError='301'; return ''; }}
      if (name === 'cmi.interactions._count') {{ lastError='0'; return countPrefix('cmi.interactions.'); }}
      if (name === 'cmi.objectives._count') {{ lastError='0'; return countPrefix('cmi.objectives.'); }}
      lastError='0'; return Object.prototype.hasOwnProperty.call(values,name) ? String(values[name]) : '';
    }},
    LMSSetValue:function (name,value) {{
      if (!initialized) {{ lastError='301'; return 'false'; }}
      if (!canWrite(name)) {{ lastError='401'; return 'false'; }}
      values[name]=String(value); lastError='0'; return 'true';
    }},
    LMSCommit:function () {{
      if (!initialized) {{ lastError='301'; return 'false'; }}
      send('commit'); lastError='0'; return 'true';
    }},
    LMSGetLastError:function () {{ return lastError; }},
    LMSGetErrorString:function (code) {{
      return {{'0':'No error','101':'General exception','301':'Not initialized','401':'Not implemented'}}[String(code)] || 'Unknown error';
    }},
    LMSGetDiagnostic:function (code) {{ return this.LMSGetErrorString(code || lastError); }}
  }};
}})();
</script>"""


@router.get("/ispring/content/{token}/{asset_path:path}")
def serve_ispring_content(
    token: str, asset_path: str, request: Request, db: Session = Depends(get_db)
) -> Response:
    claims = _decode_launch_token(token)
    package = db.get(IspringPackage, int(claims["package_id"]))
    session_row = db.get(ExamSession, int(claims["session_id"]))
    if package is None or session_row is None or session_row.ispring_package_id != package.id:
        raise HTTPException(status_code=404, detail="Quiz content not found")
    try:
        content, safe_path = read_package_member(package.archive_bytes, asset_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Quiz asset not found") from exc

    if safe_path.lower() == package.launch_file.lower():
        student = db.get(Student, session_row.student_id)
        attempt = (
            db.query(IspringAttempt)
            .filter(IspringAttempt.session_id == session_row.id)
            .first()
        )
        try:
            html = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            html = content.decode("latin-1")
        bridge = _bridge_script(
            _attempt_values(attempt, student),
            str(claims["parent_origin"]),
            str(claims["nonce"]),
        )
        lower = html.lower()
        insert_at = lower.find("<head")
        if insert_at >= 0:
            insert_at = html.find(">", insert_at) + 1
        else:
            insert_at = 0
        content = (html[:insert_at] + bridge + html[insert_at:]).encode("utf-8")

    content_type = mimetypes.guess_type(safe_path)[0] or "application/octet-stream"
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store" if safe_path.lower() == package.launch_file.lower() else "private, max-age=3600",
        "Content-Security-Policy": f"frame-ancestors {claims['parent_origin']}",
        "Referrer-Policy": "no-referrer",
        "Accept-Ranges": "bytes",
    }
    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes=") and "," not in range_header:
        try:
            start_text, end_text = range_header[6:].split("-", 1)
            if start_text:
                start = int(start_text)
                end = int(end_text) if end_text else len(content) - 1
            else:
                suffix_length = int(end_text)
                start = max(0, len(content) - suffix_length)
                end = len(content) - 1
            if start < 0 or end < start or start >= len(content):
                raise ValueError
            end = min(end, len(content) - 1)
        except (TypeError, ValueError):
            return Response(
                status_code=416,
                headers={"Content-Range": f"bytes */{len(content)}"},
            )
        headers["Content-Range"] = f"bytes {start}-{end}/{len(content)}"
        return Response(
            content=content[start : end + 1],
            status_code=206,
            media_type=content_type,
            headers=headers,
        )
    return Response(content=content, media_type=content_type, headers=headers)


def _save_scorm_state(
    session_id: int, values: dict[str, str], student: Student, db: Session
) -> tuple[IspringAttempt, ExamSession, Exam]:
    session_row = _get_owned_session_or_404(session_id, student, db)
    exam = db.get(Exam, session_row.exam_id)
    session_row = _sync_expiry(session_row, exam, db)
    if session_row.status != "in_progress" or exam.content_type != "ispring":
        raise HTTPException(status_code=409, detail="This iSpring session is not active")
    _reject_if_blocked(session_row, db)

    attempt = (
        db.query(IspringAttempt).filter(IspringAttempt.session_id == session_row.id).first()
    )
    if attempt is None:
        attempt = IspringAttempt(session_id=session_row.id)
        db.add(attempt)
    attempt.cmi_data_json = json.dumps(values, separators=(",", ":"), sort_keys=True)
    attempt.lesson_status = values.get("cmi.core.lesson_status", attempt.lesson_status)
    attempt.score_raw = values.get("cmi.core.score.raw")
    attempt.score_min = values.get("cmi.core.score.min")
    attempt.score_max = values.get("cmi.core.score.max")
    attempt.last_commit_at = datetime.utcnow()
    db.commit()
    db.refresh(attempt)
    return attempt, session_row, exam


@router.put(
    "/student/sessions/{session_id}/scorm-state",
    response_model=ScormStateResponse,
)
def commit_scorm_state(
    session_id: int,
    payload: ScormStateRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
) -> ScormStateResponse:
    attempt, _, _ = _save_scorm_state(session_id, payload.values, student, db)
    return ScormStateResponse(
        lesson_status=attempt.lesson_status, saved_at=attempt.last_commit_at
    )


def _normalized_score(attempt: IspringAttempt) -> int:
    try:
        raw = float(attempt.score_raw or "0")
        minimum = float(attempt.score_min or "0")
        maximum = float(attempt.score_max or "100")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="iSpring reported an invalid score") from exc
    if maximum <= minimum:
        raise HTTPException(status_code=422, detail="iSpring reported an invalid score range")
    return round(max(0.0, min(100.0, ((raw - minimum) / (maximum - minimum)) * 100)))


@router.post(
    "/student/sessions/{session_id}/scorm-finish",
    response_model=ScormFinishResponse,
)
def finish_scorm_attempt(
    session_id: int,
    payload: ScormStateRequest,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
) -> ScormFinishResponse:
    attempt, session_row, _ = _save_scorm_state(session_id, payload.values, student, db)
    if attempt.lesson_status not in {"passed", "failed", "completed"}:
        raise HTTPException(
            status_code=422,
            detail="The iSpring quiz has not reported a completed result",
        )
    score = _normalized_score(attempt)
    ended_at = datetime.utcnow()
    attempt.finished_at = ended_at
    session_row.status = "submitted"
    session_row.ended_at = ended_at
    session_row.score = score
    db.commit()
    log_event(
        "exam.session.submitted",
        session_id=session_row.id,
        exam_id=session_row.exam_id,
        student_id=student.student_id,
        score=score,
        source="ispring_scorm",
    )
    return ScormFinishResponse(status="submitted", score=score, ended_at=ended_at)
