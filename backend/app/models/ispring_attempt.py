from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IspringAttempt(Base):
    __tablename__ = "ispring_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("exam_sessions.id"), unique=True, nullable=False, index=True
    )
    lesson_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="not attempted"
    )
    score_raw: Mapped[str | None] = mapped_column(String(30), nullable=True)
    score_min: Mapped[str | None] = mapped_column(String(30), nullable=True)
    score_max: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cmi_data_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    last_commit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
