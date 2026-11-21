from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db.models import Exam, ExamSession, IspringPackage, Question
from app.db.session import get_db
from app.schemas.exam import (
    ExamCreate,
    ExamResponse,
    ExamStatusUpdate,
    ExamUpdate,
)
from app.schemas.question import QuestionCreate, QuestionResponse

router = APIRouter(
    prefix="/api/exams",
    tags=["exams"],
    dependencies=[Depends(require_admin)],
)


def _get_exam_or_404(exam_id: int, db: Session) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exam not found",
        )
    return exam


def _question_count(exam_id: int, db: Session) -> int:
    return db.query(Question).filter(Question.exam_id == exam_id).count()


def _to_exam_response(exam: Exam, question_count: int) -> ExamResponse:
    active_package = (
        getattr(exam, "_active_ispring_package", None)
        if exam.content_type == "ispring"
        else None
    )
    return ExamResponse(
        id=exam.id,
        title=exam.title,
        description=exam.description,
        duration_minutes=exam.duration_minutes,
        status=exam.status,
        created_at=exam.created_at,
        question_count=question_count,
        content_type=exam.content_type,
        ispring_package_uploaded=active_package is not None,
        ispring_package_version=active_package.version if active_package else None,
        require_screen_share=bool(exam.require_screen_share),
    )


def _attach_active_package(exam: Exam, db: Session) -> None:
    exam._active_ispring_package = (
        db.query(IspringPackage)
        .filter(IspringPackage.exam_id == exam.id, IspringPackage.is_active.is_(True))
        .order_by(IspringPackage.version.desc())
        .first()
    )


def _attach_active_packages(exams: list[Exam], db: Session) -> None:
    exam_ids = [exam.id for exam in exams if exam.content_type == "ispring"]
    packages = (
        db.query(IspringPackage)
        .filter(
            IspringPackage.exam_id.in_(exam_ids),
            IspringPackage.is_active.is_(True),
        )
        .all()
        if exam_ids
        else []
    )
    by_exam_id = {package.exam_id: package for package in packages}
    for exam in exams:
        exam._active_ispring_package = by_exam_id.get(exam.id)


@router.post("", response_model=ExamResponse, status_code=status.HTTP_201_CREATED)
def create_exam(payload: ExamCreate, db: Session = Depends(get_db)) -> ExamResponse:
    exam = Exam(
        title=payload.title,
        description=payload.description,
        duration_minutes=payload.duration_minutes,
        content_type=payload.content_type,
        require_screen_share=payload.require_screen_share,
        status="draft",
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    _attach_active_package(exam, db)
    return _to_exam_response(exam, question_count=0)


@router.get("", response_model=list[ExamResponse])
def list_exams(db: Session = Depends(get_db)) -> list[ExamResponse]:
    # Single grouped query (outer join + COUNT) instead of one COUNT per
    # exam, so listing N exams never issues N+1 queries.
    rows = (
        db.query(Exam, func.count(Question.id))
        .outerjoin(Question, Question.exam_id == Exam.id)
        .filter(Exam.voided_at.is_(None))
        .group_by(Exam.id)
        .order_by(Exam.id.desc())  # newest first
        .all()
    )
    _attach_active_packages([exam for exam, _ in rows], db)
    return [_to_exam_response(exam, count) for exam, count in rows]


@router.get("/{exam_id}", response_model=ExamResponse)
def get_exam(exam_id: int, db: Session = Depends(get_db)) -> ExamResponse:
    exam = _get_exam_or_404(exam_id, db)
    _attach_active_package(exam, db)
    return _to_exam_response(exam, _question_count(exam_id, db))


@router.put("/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: int, payload: ExamUpdate, db: Session = Depends(get_db)
) -> ExamResponse:
    exam = _get_exam_or_404(exam_id, db)
    exam.title = payload.title
    exam.description = payload.description
    exam.duration_minutes = payload.duration_minutes
    # Changeable at any time: it only affects attempts started (or resumed)
    # after the change, and never alters recorded evidence.
    exam.require_screen_share = payload.require_screen_share
    if exam.content_type != payload.content_type:
        has_sessions = (
            db.query(ExamSession).filter(ExamSession.exam_id == exam.id).first()
            is not None
        )
        if has_sessions:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Content type cannot be changed after an attempt has started",
            )
        exam.content_type = payload.content_type
    db.commit()
    db.refresh(exam)
    _attach_active_package(exam, db)
    return _to_exam_response(exam, _question_count(exam_id, db))


@router.patch("/{exam_id}/status", response_model=ExamResponse)
def update_exam_status(
    exam_id: int, payload: ExamStatusUpdate, db: Session = Depends(get_db)
) -> ExamResponse:
    exam = _get_exam_or_404(exam_id, db)
    if payload.status == "active" and exam.content_type == "ispring":
        active_package = (
            db.query(IspringPackage)
            .filter(IspringPackage.exam_id == exam.id, IspringPackage.is_active.is_(True))
            .first()
        )
        if active_package is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Upload a valid iSpring SCORM package before activating this exam",
            )
    exam.status = payload.status
    db.commit()
    db.refresh(exam)
    _attach_active_package(exam, db)
    return _to_exam_response(exam, _question_count(exam_id, db))


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(exam_id: int, db: Session = Depends(get_db)) -> None:
    exam = _get_exam_or_404(exam_id, db)

    has_questions = db.query(Question).filter(Question.exam_id == exam_id).first() is not None
    has_sessions = (
        db.query(ExamSession).filter(ExamSession.exam_id == exam_id).first() is not None
    )
    has_packages = (
        db.query(IspringPackage).filter(IspringPackage.exam_id == exam_id).first()
        is not None
    )
    if has_questions or has_sessions or has_packages:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete an exam that has questions or exam sessions",
        )

    db.delete(exam)
    db.commit()


@router.post(
    "/{exam_id}/questions",
    response_model=QuestionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_question(
    exam_id: int, payload: QuestionCreate, db: Session = Depends(get_db)
) -> Question:
    exam = _get_exam_or_404(exam_id, db)
    if exam.content_type != "native":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions are managed inside iSpring for this exam",
        )

    question = Question(
        exam_id=exam_id,
        question_text=payload.question_text,
        option_a=payload.option_a,
        option_b=payload.option_b,
        option_c=payload.option_c,
        option_d=payload.option_d,
        correct_answer=payload.correct_answer,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.get("/{exam_id}/questions", response_model=list[QuestionResponse])
def list_questions(exam_id: int, db: Session = Depends(get_db)) -> list[Question]:
    _get_exam_or_404(exam_id, db)
    return db.query(Question).filter(Question.exam_id == exam_id).order_by(Question.id).all()
