import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "9f202611131800_add_traffic_analysis_reports.py"
)


def load_migration():
    spec = importlib.util.spec_from_file_location("traffic_report_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def create_parent_tables(connection):
    metadata = sa.MetaData()
    sa.Table("junctions", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("users", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(connection)


def test_migration_adopts_existing_table_without_losing_reports():
    engine = sa.create_engine("sqlite://")
    migration = load_migration()
    with engine.begin() as connection:
        create_parent_tables(connection)
        connection.exec_driver_sql(
            """
            CREATE TABLE traffic_analysis_reports (
                id INTEGER PRIMARY KEY,
                public_id VARCHAR(36) NOT NULL UNIQUE,
                report_type VARCHAR(40) NOT NULL,
                junction_id INTEGER NULL REFERENCES junctions(id) ON DELETE SET NULL,
                source_name VARCHAR(180) NOT NULL DEFAULT 'unknown source',
                source_mode VARCHAR(40) NOT NULL DEFAULT 'unknown',
                summary JSON NOT NULL,
                result JSON NOT NULL,
                created_by_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO traffic_analysis_reports
            (id, public_id, report_type, summary, result, created_at, updated_at)
            VALUES (41, 'existing-report-41', 'camera', '{}', '{"vehicles": 4}',
                    '2026-11-13 00:00:00', '2026-11-13 00:00:00')
            """
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

        row = connection.execute(
            sa.text("SELECT id, public_id, report_type FROM traffic_analysis_reports WHERE id = 41")
        ).one()
        assert tuple(row) == (41, "existing-report-41", "camera")
        index_names = {item["name"] for item in sa.inspect(connection).get_indexes("traffic_analysis_reports")}
        assert {
            "ix_traffic_analysis_reports_public_id",
            "ix_traffic_analysis_reports_report_type",
            "ix_traffic_analysis_reports_junction_id",
            "ix_traffic_reports_created",
        }.issubset(index_names)
    engine.dispose()


def test_migration_creates_report_table_on_fresh_database():
    engine = sa.create_engine("sqlite://")
    migration = load_migration()
    with engine.begin() as connection:
        create_parent_tables(connection)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        inspector = sa.inspect(connection)
        assert inspector.has_table("traffic_analysis_reports")
        columns = {column["name"] for column in inspector.get_columns("traffic_analysis_reports")}
        assert {
            "id", "public_id", "report_type", "junction_id", "source_name", "source_mode",
            "summary", "result", "created_by_user_id", "created_at", "updated_at",
        }.issubset(columns)
        indexes = {item["name"] for item in inspector.get_indexes("traffic_analysis_reports")}
        assert "ix_traffic_analysis_reports_public_id" in indexes
    engine.dispose()


def test_migration_stops_on_incomplete_existing_table_without_dropping_it():
    engine = sa.create_engine("sqlite://")
    migration = load_migration()
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE traffic_analysis_reports (id INTEGER PRIMARY KEY)")
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match="required columns are missing"):
                migration.upgrade()
        assert sa.inspect(connection).has_table("traffic_analysis_reports")
        assert [column["name"] for column in sa.inspect(connection).get_columns("traffic_analysis_reports")] == ["id"]
    engine.dispose()
