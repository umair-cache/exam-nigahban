from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExamStatus = Literal["draft", "active", "inactive"]
ExamContentType = Literal["native", "ispring"]


class ExamCreate(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = None
    duration_minutes: int = Field(gt=0)
    content_type: ExamContentType = "native"
    # On by default: exams run in onsite computer labs, where proof of what a
    # candidate opened needs entire-screen sharing (see models/exam.py).
    require_screen_share: bool = True


class ExamUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str | None = None
    duration_minutes: int = Field(gt=0)
    content_type: ExamContentType = "native"
    require_screen_share: bool = False


class ExamStatusUpdate(BaseModel):
    status: ExamStatus


class ExamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    duration_minutes: int
    status: str
    created_at: datetime
    question_count: int = 0
    content_type: ExamContentType = "native"
    ispring_package_uploaded: bool = False
    ispring_package_version: int | None = None
    require_screen_share: bool = False
