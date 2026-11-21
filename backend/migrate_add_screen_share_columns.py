"""Idempotently add the screen-sharing requirement column to existing databases.

The screen_captures table itself needs no script: init_db.py's create_all
creates any missing table. create_all cannot add a column to an existing
table, which is what this script is for.
"""

from app.db.migration_utils import add_column, boolean_false_literal
from app.db.session import engine


def migrate() -> None:
    add_column(
        engine,
        "exams",
        "require_screen_share",
        f"NOT NULL DEFAULT {boolean_false_literal(engine)}",
    )


if __name__ == "__main__":
    migrate()
    print("Screen-sharing columns are present")
