"""Idempotently add iSpring integration columns to existing databases."""

from app.db.migration_utils import add_column
from app.db.session import engine


def migrate() -> None:
    add_column(
        engine,
        "exams",
        "content_type",
        "NOT NULL DEFAULT 'native'",
    )
    add_column(engine, "exam_sessions", "ispring_package_id")


if __name__ == "__main__":
    migrate()
    print("iSpring integration columns are present")
