"""Repair the transit_routes table if an older deployment drifted from Alembic.

Revision ID: 3d6c2fa18b41
Revises: e77103841fd2
Create Date: 2026-10-09

The original schema migration remains unchanged. This forward-only repair is safe for
fresh databases (where the table already exists) and old databases whose revision
history says the table should exist but whose physical schema is missing it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "3d6c2fa18b41"
down_revision = "e77103841fd2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if "transit_routes" not in inspector.get_table_names():
        op.create_table(
            "transit_routes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("external_id", sa.String(length=100), nullable=False),
            sa.Column("short_name", sa.String(length=80), nullable=True),
            sa.Column("long_name", sa.String(length=200), nullable=True),
            sa.Column("mode", sa.String(length=30), nullable=False, server_default="bus"),
            sa.Column("agency_name", sa.String(length=160), nullable=True),
            sa.Column("route_color", sa.String(length=12), nullable=True),
            sa.Column("source", sa.String(length=80), nullable=False, server_default="gtfs"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        inspector = inspect(bind)

    existing_indexes = {item["name"] for item in inspector.get_indexes("transit_routes")}
    if "ix_transit_routes_external_id" not in existing_indexes:
        op.create_index("ix_transit_routes_external_id", "transit_routes", ["external_id"], unique=True)
    if "ix_transit_routes_mode" not in existing_indexes:
        op.create_index("ix_transit_routes_mode", "transit_routes", ["mode"], unique=False)


def downgrade() -> None:
    # This repair may have upgraded an installation that used this table before the
    # revision. Dropping it on downgrade could destroy data, so leave it in place.
    pass
