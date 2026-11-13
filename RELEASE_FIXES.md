# UrbanSaarthi release repair notes

## Production migration repair

- Revision `9f202611131800` now supports both a fresh database and a database where `traffic_analysis_reports` already exists from an earlier application release.
- If the table exists, the migration verifies the required columns and creates only missing indexes. It does not drop, recreate, or clear report rows.
- If the existing table is incomplete, the migration stops with a schema-specific error instead of silently marking an invalid schema as migrated.
- PostgreSQL Alembic upgrades are serialized with a session-level advisory lock to prevent simultaneous service instances from racing through DDL.
- The migration downgrade intentionally keeps the report table because the migration may have adopted a table that existed before Alembic tracked it. Removing saved reports requires a separate, explicit data-retention operation.

## Deployment/startup repairs

- Render, the backend Docker image, and the Cloud Run image now use `backend/scripts/start.sh` as the shared startup path.
- The startup script applies Alembic migrations, registers missing connector/source records, then starts Uvicorn.
- Connector seeding uses a PostgreSQL transaction advisory lock and remains idempotent across simultaneous instance starts.
- The backend-only Dockerfile copies all included requirements files before installing dependencies.
- Removed a duplicate `TOMTOM_API_KEY` declaration from `render.yaml`.

## Deploying this release

1. Replace the repository contents with this release and push the changes.
2. Keep the existing production PostgreSQL database URL configured in Render or Google Secret Manager. Do not point the service at a new/empty database unless starting over is intentional.
3. Redeploy. Startup will run `alembic upgrade heads`; no manual `alembic stamp`, table drop, or SQL reset is required for the reported duplicate-table case when the existing report table has the expected schema.
4. Confirm the logs show the migration completing and Uvicorn starting. Then check `/healthz`, `/readyz`, and `/api/v1/traffic-detection/reports`.

The migration deliberately refuses to guess how to repair an incomplete pre-existing report table. If that validation error appears, preserve the database and inspect the missing columns before creating a separate corrective migration.
