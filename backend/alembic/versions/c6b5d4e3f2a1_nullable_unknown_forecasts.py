"""Represent unknown predicted queue and wait as NULL instead of zero."""
from alembic import op
import sqlalchemy as sa

revision = "c6b5d4e3f2a1"
down_revision = "ab34c2d16f70"
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.batch_alter_table("traffic_forecasts") as batch_op:
        batch_op.alter_column("predicted_queue_length_m", existing_type=sa.Float(), nullable=True)
        batch_op.alter_column("predicted_average_wait_seconds", existing_type=sa.Float(), nullable=True)

def downgrade() -> None:
    op.execute("UPDATE traffic_forecasts SET predicted_queue_length_m = 0 WHERE predicted_queue_length_m IS NULL")
    op.execute("UPDATE traffic_forecasts SET predicted_average_wait_seconds = 0 WHERE predicted_average_wait_seconds IS NULL")
    with op.batch_alter_table("traffic_forecasts") as batch_op:
        batch_op.alter_column("predicted_average_wait_seconds", existing_type=sa.Float(), nullable=False)
        batch_op.alter_column("predicted_queue_length_m", existing_type=sa.Float(), nullable=False)
