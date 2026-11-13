"""persist camera, video and agent analysis reports

Revision ID: 9f202611131800
Revises: c21f1001a802
Create Date: 2026-11-13
"""
from alembic import op
import sqlalchemy as sa

revision = "9f202611131800"
down_revision = "c21f1001a802"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "traffic_analysis_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("report_type", sa.String(length=40), nullable=False),
        sa.Column("junction_id", sa.Integer(), sa.ForeignKey("junctions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_name", sa.String(length=180), nullable=False, server_default="unknown source"),
        sa.Column("source_mode", sa.String(length=40), nullable=False, server_default="unknown"),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_traffic_analysis_reports_public_id", "traffic_analysis_reports", ["public_id"], unique=True)
    op.create_index("ix_traffic_analysis_reports_report_type", "traffic_analysis_reports", ["report_type"])
    op.create_index("ix_traffic_analysis_reports_junction_id", "traffic_analysis_reports", ["junction_id"])
    op.create_index("ix_traffic_reports_created", "traffic_analysis_reports", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_traffic_reports_created", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_junction_id", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_report_type", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_public_id", table_name="traffic_analysis_reports")
    op.drop_table("traffic_analysis_reports")
