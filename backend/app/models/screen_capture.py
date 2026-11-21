from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScreenCapture(Base):
    """A screenshot of the candidate's entire screen, taken while they were
    away from the exam screen, attached to that LEFT_EXAM_SCREEN event.

    Kept in its own table rather than in `evidence`, whose rows are unique
    per event and are joined by many queries on that assumption: several
    screenshots per event here can never duplicate rows anywhere else.
    """

    __tablename__ = "screen_captures"
    __table_args__ = (
        UniqueConstraint("event_id", "sequence", name="uq_screen_capture_event_sequence"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    event_id: Mapped[int] = mapped_column(
        ForeignKey("monitoring_events.id"),
        nullable=False,
        index=True,
    )

    # 1..MAX_SCREEN_CAPTURES_PER_EVENT, in the order the captures were taken.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    # Milliseconds after the candidate left the exam screen.
    offset_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    image_path: Mapped[str] = mapped_column(String(255), nullable=False)

    # SHA-256 of the stored JPEG bytes, so a report can show the image was
    # not altered after it was received.
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    captured_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Same convention as Evidence.metadata: holds a base64 survival copy
    # only when the storage backend is not durable.
    metadata_json: Mapped[dict] = mapped_column(
        "metadata", JSON, nullable=False, default=dict
    )
