"""Screen captures attached to LEFT_EXAM_SCREEN violations.

A candidate taking an exam that requires screen sharing
(Exam.require_screen_share) uploads up to MAX_SCREEN_CAPTURES_PER_EVENT
screenshots of their entire screen, taken only while they were away from
the exam screen, right after the violation itself has been recorded.
Administrators list and view them from the evidence review panel; every
view is logged, because a screenshot can contain unrelated personal
information.

Storage, validation and the durability fallback deliberately mirror camera
evidence (app/services/evidence_storage.py, monitoring.py
_try_attach_evidence).
"""

import base64
import hashlib
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.api.routes.evidence import record_review_decision, stage_review_decision
from app.api.routes.student_exams import get_current_student
from app.core.logging import log_event
from app.core.monitoring_constants import MAX_SCREEN_CAPTURES_PER_EVENT
from app.db.models import Exam, ExamSession, MonitoringEvent, ScreenCapture, Student, User
from app.db.session import get_db
from app.schemas.admin_action import (
    AdminActionResponse,
    BulkReviewedEvent,
    BulkReviewRequest,
    BulkReviewResponse,
    BulkSkippedEvent,
    EventReviewResponse,
    EvidenceReviewRequest,
)
from app.schemas.screen_capture import (
    ScreenCaptureCreate,
    ScreenCaptureListResponse,
    ScreenCaptureResponse,
)
from app.services.evidence_storage import (
    EvidenceValidationError,
    decode_and_validate_image,
    delete_evidence_file,
    evidence_storage_is_durable,
    read_evidence_image,
    save_screen_capture_image,
)
from app.websocket.review_updates import broadcast_review_queue_changed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/monitoring", tags=["screen-captures"])

# Screenshots are uploaded right after their violation is recorded; a
# window this generous covers slow connections while preventing images
# from being attached to an old violation later on.
UPLOAD_WINDOW = timedelta(minutes=10)

SCREEN_CAPTURE_EVENT_TYPE = "LEFT_EXAM_SCREEN"


def _get_visible_event_or_404(event_id: int, db: Session) -> MonitoringEvent:
    event = db.get(MonitoringEvent, event_id)
    # A voided event is withdrawn from every view, and its captures with it.
    if event is None or event.voided_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Monitoring event not found")
    return event


@router.post(
    "/events/{event_id}/screen-captures",
    response_model=ScreenCaptureResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_screen_capture(
    event_id: int,
    payload: ScreenCaptureCreate,
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
) -> ScreenCaptureResponse:
    event = _get_visible_event_or_404(event_id, db)
    session_row = db.get(ExamSession, event.session_id)
    # Another student's event answers exactly like a missing one.
    if session_row is None or session_row.student_id != student.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Monitoring event not found")

    if event.event_type != SCREEN_CAPTURE_EVENT_TYPE:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Screen captures can only be attached to a 'Left Exam Screen' event",
        )

    exam = db.get(Exam, session_row.exam_id)
    if exam is None or not exam.require_screen_share:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This exam does not use screen captures",
        )

    if datetime.utcnow() - event.detected_at > UPLOAD_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The upload window for this event has closed",
        )

    existing = db.query(ScreenCapture).filter(ScreenCapture.event_id == event.id)
    if existing.count() >= MAX_SCREEN_CAPTURES_PER_EVENT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This event already has the maximum number of screen captures",
        )
    if existing.filter(ScreenCapture.sequence == payload.sequence).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A screen capture with this sequence number already exists",
        )

    try:
        image_bytes = decode_and_validate_image(payload.image_base64)
    except EvidenceValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))

    captured_at = datetime.utcnow()
    try:
        relative_path = save_screen_capture_image(image_bytes, event.id, payload.sequence, captured_at)
    except OSError:
        logger.exception("Failed to store screen capture for event %s", event.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store the screen capture",
        )

    metadata_json: dict = {"content_type": "image/jpeg"}
    if not evidence_storage_is_durable():
        # Same survival copy as camera evidence on an ephemeral filesystem.
        metadata_json["image_base64"] = payload.image_base64

    capture = ScreenCapture(
        event_id=event.id,
        sequence=payload.sequence,
        offset_ms=payload.offset_ms,
        image_path=relative_path,
        sha256=hashlib.sha256(image_bytes).hexdigest(),
        size_bytes=len(image_bytes),
        captured_at=captured_at,
        metadata_json=metadata_json,
    )
    try:
        db.add(capture)
        db.commit()
        db.refresh(capture)
    except SQLAlchemyError:
        db.rollback()
        delete_evidence_file(relative_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record the screen capture",
        )

    log_event(
        "screen_capture.stored",
        capture_id=capture.id,
        event_id=event.id,
        session_id=event.session_id,
        sequence=capture.sequence,
        size_bytes=capture.size_bytes,
    )
    return ScreenCaptureResponse.model_validate(capture)


@router.get(
    "/events/{event_id}/screen-captures",
    response_model=ScreenCaptureListResponse,
)
def list_screen_captures(
    event_id: int,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ScreenCaptureListResponse:
    _get_visible_event_or_404(event_id, db)
    captures = (
        db.query(ScreenCapture)
        .filter(ScreenCapture.event_id == event_id)
        .order_by(ScreenCapture.sequence)
        .all()
    )
    return ScreenCaptureListResponse(
        items=[ScreenCaptureResponse.model_validate(capture) for capture in captures]
    )


@router.get("/screen-captures/{capture_id}/image")
def get_screen_capture_image(
    capture_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    capture = db.get(ScreenCapture, capture_id)
    if capture is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screen capture not found")
    _get_visible_event_or_404(capture.event_id, db)

    try:
        image_bytes = read_evidence_image(capture.image_path)
    except OSError:
        backup = (capture.metadata_json or {}).get("image_base64")
        if not backup:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screen capture image not found")
        try:
            image_bytes = base64.b64decode(backup, validate=True)
        except (ValueError, TypeError):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Screen capture image not found")

    # Every view is recorded: a screenshot may show unrelated personal data.
    log_event(
        "screen_capture.viewed",
        capture_id=capture.id,
        event_id=capture.event_id,
        admin=admin.username,
    )
    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/events/{event_id}/review", response_model=EventReviewResponse)
def review_event(
    event_id: int,
    payload: EvidenceReviewRequest,
    background_tasks: BackgroundTasks,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> EventReviewResponse:
    """Records a CONFIRMED/IGNORED decision directly on a monitoring event.

    Identical in effect to POST /api/evidence/{id}/review (same shared
    record_review_decision), for violations that carry no camera photo --
    a decision must never depend on a photo existing.
    """
    event = _get_visible_event_or_404(event_id, db)
    admin_action = record_review_decision(event, payload, current_admin, db, background_tasks)
    return EventReviewResponse(
        event_id=event.id,
        status=event.status,
        action=AdminActionResponse.model_validate(admin_action),
    )


@router.post("/events/bulk-review", response_model=BulkReviewResponse)
def bulk_review_events(
    payload: BulkReviewRequest,
    background_tasks: BackgroundTasks,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> BulkReviewResponse:
    """Applies one CONFIRMED/IGNORED decision to several violations.

    Each event gets its own AdminAction row through the same
    stage_review_decision as a single review, so the audit trail still
    lists every decision separately. All valid events are committed in one
    transaction -- either every one of them is recorded or none is. Events
    that do not exist or have been voided are skipped and reported, never
    silently dropped.
    """
    decision = EvidenceReviewRequest(action=payload.action, reason=payload.reason)
    events = {
        event.id: event
        for event in db.query(MonitoringEvent)
        .filter(MonitoringEvent.id.in_(payload.event_ids), MonitoringEvent.voided_at.is_(None))
        .all()
    }

    staged: list[tuple[MonitoringEvent, object]] = []
    skipped: list[BulkSkippedEvent] = []
    for event_id in payload.event_ids:
        event = events.get(event_id)
        if event is None:
            skipped.append(BulkSkippedEvent(event_id=event_id, reason="not_found"))
            continue
        staged.append((event, stage_review_decision(event, decision, current_admin, db)))

    if staged:
        try:
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to record the review decisions",
            )

    reviewed: list[BulkReviewedEvent] = []
    for event, admin_action in staged:
        db.refresh(admin_action)
        reviewed.append(
            BulkReviewedEvent(event_id=event.id, status=event.status, action_id=admin_action.id)
        )
        log_event(
            "evidence.reviewed",
            event_id=event.id,
            session_id=event.session_id,
            admin=current_admin.username,
            decision=payload.action,
            bulk=True,
        )

    # One announcement for the whole batch, after the commit.
    if staged:
        background_tasks.add_task(broadcast_review_queue_changed, "events_bulk_reviewed")
    return BulkReviewResponse(reviewed=reviewed, skipped=skipped)
