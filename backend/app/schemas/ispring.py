from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class IspringPackageResponse(BaseModel):
    id: int
    exam_id: int
    version: int
    original_filename: str
    checksum_sha256: str
    launch_file: str
    uploaded_at: datetime
    is_active: bool


class IspringLaunchResponse(BaseModel):
    launch_url: str
    message_nonce: str
    content_origin: str


class ScormStateRequest(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)

    @field_validator("values")
    @classmethod
    def validate_values(cls, values: dict[str, str]) -> dict[str, str]:
        allowed = {
            "cmi.core.lesson_status",
            "cmi.core.score.raw",
            "cmi.core.score.min",
            "cmi.core.score.max",
            "cmi.core.lesson_location",
            "cmi.core.session_time",
            "cmi.core.exit",
            "cmi.suspend_data",
            "cmi.comments",
        }
        allowed_prefixes = ("cmi.interactions.", "cmi.objectives.", "cmi.student_preference.")
        if any(
            key not in allowed and not key.startswith(allowed_prefixes)
            for key in values
        ):
            raise ValueError("Unsupported SCORM data model element")
        normalized = {str(key): str(value) for key, value in values.items()}
        if sum(len(key) + len(value) for key, value in normalized.items()) > 262144:
            raise ValueError("SCORM state is too large")
        if len(normalized.get("cmi.suspend_data", "")) > 32768:
            raise ValueError("SCORM suspend data is too large")
        lesson_status = normalized.get("cmi.core.lesson_status")
        if lesson_status is not None and lesson_status not in {
            "passed",
            "completed",
            "failed",
            "incomplete",
            "browsed",
            "not attempted",
        }:
            raise ValueError("Invalid SCORM lesson status")
        for score_key in (
            "cmi.core.score.raw",
            "cmi.core.score.min",
            "cmi.core.score.max",
        ):
            if len(normalized.get(score_key, "")) > 30:
                raise ValueError("Invalid SCORM score")
        return normalized


class ScormStateResponse(BaseModel):
    lesson_status: str
    saved_at: datetime


class ScormFinishResponse(BaseModel):
    status: Literal["submitted"]
    score: int
    ended_at: datetime
