"""persist camera, video and agent analysis reports

Revision ID: 9f202611131800
Revises: c21f1001a802
Create Date: 2026-11-13

This migration also adopts the report table when it was created by an earlier
application release before Alembic recorded this revision. Existing report rows
are never dropped or recreated.
"""
from alembic import op
import sqlalchemy as sa

revision = "9f202611131800"
down_revision = "c21f1001a802"
branch_labels = None
depends_on = None

_TABLE = "traffic_analysis_reports"
_REQUIRED_COLUMNS = {
    "id",
    "public_id",
    "report_type",
    "junction_id",
    "source_name",
    "source_mode",
    "summary",
    "result",
    "created_by_user_id",
    "created_at",
    "updated_at",
}
_INDEXES = (
    ("ix_traffic_analysis_reports_public_id", ("public_id",), True),
    ("ix_traffic_analysis_reports_report_type", ("report_type",), False),
    ("ix_traffic_analysis_reports_junction_id", ("junction_id",), False),
    ("ix_traffic_reports_created", ("created_at",), False),
)


def _ensure_report_table() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table(_TABLE):
        op.create_table(
            _TABLE,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("public_id", sa.String(length=36), nullable=False),
            sa.Column("report_type", sa.String(length=40), nullable=False),
            sa.Column(
                "junction_id",
                sa.Integer(),
                sa.ForeignKey("junctions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source_name", sa.String(length=180), nullable=False, server_default="unknown source"),
            sa.Column("source_mode", sa.String(length=40), nullable=False, server_default="unknown"),
            sa.Column("summary", sa.JSON(), nullable=False),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.Column(
                "created_by_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("public_id"),
        )
        # Re-inspect after CREATE TABLE because the table/index catalogue changed.
        inspector = sa.inspect(bind)

    existing_columns = {column["name"] for column in inspector.get_columns(_TABLE)}
    missing_columns = sorted(_REQUIRED_COLUMNS - existing_columns)
    if missing_columns:
        raise RuntimeError(
            f"Cannot adopt existing {_TABLE}: required columns are missing: "
            f"{', '.join(missing_columns)}. No existing table or report rows were dropped. "
            "Review the production schema and create a dedicated corrective migration."
        )

    # A previous create_all() may have created the table and some/all indexes.
    # Create only missing indexes; reject same-name indexes with a different shape.
    for index_name, columns, unique in _INDEXES:
        current_indexes = {item["name"]: item for item in sa.inspect(bind).get_indexes(_TABLE)}
        current = current_indexes.get(index_name)
        if current is not None:
            actual_columns = tuple(current.get("column_names") or ())
            actual_unique = bool(current.get("unique"))
            if actual_columns != columns or actual_unique != unique:
                raise RuntimeError(
                    f"Cannot adopt existing {_TABLE}: index {index_name} has definition "
                    f"columns={actual_columns}, unique={actual_unique}; expected "
                    f"columns={columns}, unique={unique}. No report rows were changed."
                )
            continue
        op.create_index(index_name, _TABLE, list(columns), unique=unique)


def upgrade() -> None:
    _ensure_report_table()


def downgrade() -> None:
    # This revision can adopt a table that predates Alembic's revision marker.
    # Alembic cannot distinguish an adopted table from one created here. Dropping
    # it would therefore risk deleting production reports, so downgrade is
    # intentionally non-destructive. Remove the table only through an explicit,
    # separately reviewed data-retention operation.
    pass
