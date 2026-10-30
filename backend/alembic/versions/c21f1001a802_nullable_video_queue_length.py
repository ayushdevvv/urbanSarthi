"""allow unknown queue length for vision-only observations

Revision ID: c21f1001a802
Revises: e77103841fd2
Create Date: 2026-10-26
"""
from alembic import op
import sqlalchemy as sa

revision = "c21f1001a802"
down_revision = "e77103841fd2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("traffic_observations") as batch_op:
        batch_op.alter_column(
            "queue_length_m",
            existing_type=sa.Float(),
            nullable=True,
        )


def downgrade() -> None:
    # Unknown measurements cannot be represented in the old non-null schema.
    op.execute(sa.text("UPDATE traffic_observations SET queue_length_m = 0 WHERE queue_length_m IS NULL"))
    with op.batch_alter_table("traffic_observations") as batch_op:
        batch_op.alter_column(
            "queue_length_m",
            existing_type=sa.Float(),
            nullable=False,
        )
