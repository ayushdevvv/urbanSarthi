"""add persisted traffic analysis reports

Revision ID: 4fa8c8210d31
Revises: e77103841fd2
Create Date: 2026-11-13
"""
from alembic import op
import sqlalchemy as sa

revision = "4fa8c8210d31"
down_revision = "e77103841fd2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "traffic_analysis_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("report_type", sa.String(length=40), nullable=False, server_default="traffic_analysis"),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("source_name", sa.String(length=180), nullable=False, server_default="Traffic evidence"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="completed"),
        sa.Column("junction_id", sa.Integer(), sa.ForeignKey("junctions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("result", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("provenance", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_traffic_analysis_reports_public_id", "traffic_analysis_reports", ["public_id"], unique=True)
    op.create_index("ix_traffic_analysis_reports_report_type", "traffic_analysis_reports", ["report_type"])
    op.create_index("ix_traffic_analysis_reports_status", "traffic_analysis_reports", ["status"])
    op.create_index("ix_traffic_analysis_reports_junction_id", "traffic_analysis_reports", ["junction_id"])
    op.create_index("ix_traffic_report_created", "traffic_analysis_reports", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_traffic_report_created", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_junction_id", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_status", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_report_type", table_name="traffic_analysis_reports")
    op.drop_index("ix_traffic_analysis_reports_public_id", table_name="traffic_analysis_reports")
    op.drop_table("traffic_analysis_reports")
