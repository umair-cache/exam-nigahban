from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.monitoring_constants import MAX_SCREEN_CAPTURES_PER_EVENT


class ScreenCaptureCreate(BaseModel):
    # Validated (JPEG, size) by the same decode_and_validate_image used for
    # camera evidence; deliberately unconstrained here so the route can
    # report a clear 422 message.
    image_base64: str
    sequence: int = Field(ge=1, le=MAX_SCREEN_CAPTURES_PER_EVENT)
    offset_ms: int = Field(ge=0)


class ScreenCaptureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    sequence: int
    offset_ms: int
    captured_at: datetime
    size_bytes: int
    sha256: str


class ScreenCaptureListResponse(BaseModel):
    items: list[ScreenCaptureResponse]
