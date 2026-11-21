from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        index=True,
    )

    title: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    duration_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="draft",
    )

    # "native" uses Exam Nigahban's built-in question renderer; "ispring"
    # launches the active, validated SCORM package assigned to the exam.
    content_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="native", server_default="native"
    )

    # When true, a candidate must share their ENTIRE screen to take this
    # exam, and screenshots are taken only while they are away from the
    # exam screen (attached to the LEFT_EXAM_SCREEN violation as
    # ScreenCapture rows). New exams default to on (onsite computer-based
    # assessments); the server default stays 0 so the migration leaves
    # existing exams exactly as they were.
    require_screen_share: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="0",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    # Voiding, not deletion. This system's guarantee is an append-only
    # record, so a row that must stop having effect is marked rather than
    # removed: it disappears from every queue, count and report, but
    # survives with who voided it, when, and why. That keeps the question
    # "what happened to this record?" answerable, which a DELETE does not.
    #
    # Set only through the system-administrator void endpoint, which
    # requires a re-entered password and a written reason.
    voided_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    voided_by_admin_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
    )

    void_reason: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
