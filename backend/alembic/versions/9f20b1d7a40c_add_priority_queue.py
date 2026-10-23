"""add AI-triaged authority priority queue"""
from alembic import op
import sqlalchemy as sa
revision = "9f20b1d7a40c"
down_revision = "e77103841fd2"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "priority_queue_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="operations"),
        sa.Column("source", sa.String(length=80), nullable=False, server_default="operator"),
        sa.Column("location", sa.String(length=180), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("priority_score", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("urgency", sa.String(length=30), nullable=False, server_default="normal"),
        sa.Column("ai_provider", sa.String(length=60), nullable=False, server_default="rules-fallback"),
        sa.Column("ai_rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("suggested_actions", sa.JSON(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("assigned_to", sa.String(length=160), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_priority_queue_items_public_id", "priority_queue_items", ["public_id"], unique=True)
    for col in ("title", "category", "status", "priority", "priority_score"):
        op.create_index(f"ix_priority_queue_items_{col}", "priority_queue_items", [col], unique=False)
    op.create_index("ix_priority_queue_status_score", "priority_queue_items", ["status", "priority_score"], unique=False)
    with op.batch_alter_table("traffic_observations") as batch_op:
        batch_op.alter_column("queue_length_m", existing_type=sa.Float(), nullable=True)

def downgrade() -> None:
    with op.batch_alter_table("traffic_observations") as batch_op:
        batch_op.alter_column("queue_length_m", existing_type=sa.Float(), nullable=False)
    op.drop_index("ix_priority_queue_status_score", table_name="priority_queue_items")
    for col in ("title", "category", "status", "priority", "priority_score", "public_id"):
        op.drop_index(f"ix_priority_queue_items_{col}", table_name="priority_queue_items")
    op.drop_table("priority_queue_items")
