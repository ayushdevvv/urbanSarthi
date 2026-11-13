"""Repair legacy traffic report columns for databases already stamped.

Revision ID: b31a2026111313
Revises: 9f202611131800
"""
from alembic import op
import sqlalchemy as sa

revision = "b31a2026111313"
down_revision = "9f202611131800"
branch_labels = None
depends_on = None

_TABLE = "traffic_analysis_reports"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(_TABLE):
        raise RuntimeError(
            f"Expected {_TABLE} after migration 9f202611131800, but the table is missing."
        )

    existing = {column["name"] for column in inspector.get_columns(_TABLE)}
    additions = (
        sa.Column(
            "source_mode",
            sa.String(length=40),
            nullable=False,
            server_default=sa.text("'unknown'"),
        ),
        sa.Column(
            "summary",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    for column in additions:
        if column.name not in existing:
            op.add_column(_TABLE, column)
            existing.add(column.name)


def downgrade() -> None:
    # Intentionally non-destructive: these fields may have been added to a
    # pre-existing table, and removing them could break current application code.
    pass
