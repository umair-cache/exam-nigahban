"""Tells connected admins that the review queue changed.

Sent after a review decision or a void is committed, so every admin's
"pending review" badge and dashboard update live -- including admins on
other computers. The message is only a nudge: it carries what changed and
the record id, never student data or the decision's reason, and clients
re-read the authoritative counts from the API.

Scheduled as a FastAPI background task, so it runs after the HTTP response
has been sent and can never delay or fail the request. Any delivery error
is logged and swallowed, exactly like the existing monitoring and
enforcement broadcasts.
"""

import logging
from typing import Literal

from app.websocket.manager import manager as websocket_manager

logger = logging.getLogger(__name__)

ReviewChange = Literal["event_reviewed", "events_bulk_reviewed", "event_voided", "exam_voided"]


async def broadcast_review_queue_changed(
    change: ReviewChange,
    *,
    event_id: int | None = None,
    exam_id: int | None = None,
) -> None:
    message: dict = {"type": "review_queue_changed", "change": change}
    if event_id is not None:
        message["event_id"] = event_id
    if exam_id is not None:
        message["exam_id"] = exam_id
    try:
        await websocket_manager.broadcast(message)
    except Exception:
        logger.exception("Failed to broadcast review queue change (%s)", change)
