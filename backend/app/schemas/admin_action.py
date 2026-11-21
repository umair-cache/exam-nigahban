from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Mirrors the two admin decisions MonitoringEvent.status can be moved to
# from PENDING_REVIEW by a human reviewer: automated monitoring flags
# an activity, and only an administrator ever confirms what it means.
ReviewAction = Literal["CONFIRMED", "IGNORED"]


class EvidenceReviewRequest(BaseModel):
    action: ReviewAction
    reason: str | None = None


class AdminActionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    admin_id: int
    action: str
    reason: str | None
    created_at: datetime


class EventReviewResponse(BaseModel):
    event_id: int
    status: str
    action: "AdminActionResponse"


class EvidenceReviewResponse(BaseModel):
    evidence_id: int
    event_id: int
    status: str
    action: AdminActionResponse


BULK_REVIEW_MAX_EVENTS = 100


class BulkReviewRequest(BaseModel):
    """One decision applied to several violations at once. The remark is
    optional, exactly as on a single review."""

    event_ids: list[int] = Field(min_length=1, max_length=BULK_REVIEW_MAX_EVENTS)
    action: ReviewAction
    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("event_ids")
    @classmethod
    def _unique_ids(cls, value: list[int]) -> list[int]:
        # Keeps the caller's order, drops repeats: one audit row per event.
        return list(dict.fromkeys(value))

    @field_validator("reason")
    @classmethod
    def _blank_reason_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class BulkReviewedEvent(BaseModel):
    event_id: int
    status: str
    action_id: int


class BulkSkippedEvent(BaseModel):
    event_id: int
    # not_found: no such event, or it has been voided (withdrawn from view).
    reason: Literal["not_found"]


class BulkReviewResponse(BaseModel):
    reviewed: list[BulkReviewedEvent]
    skipped: list[BulkSkippedEvent]
