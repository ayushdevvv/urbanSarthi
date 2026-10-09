from contextlib import asynccontextmanager
import os
import subprocess
import sys
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError
from app.api import admin, alerts, analytics, aqi, command_center, ingestion, integrations, mobility, predictions, signals, ticketing, traffic, transit
from app.core.config import settings
from app.db import engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _env_enabled(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _prepare_production_database() -> None:
    """Apply Alembic migrations before serving traffic on PostgreSQL deployments.

    Render services often start with plain uvicorn. Applying committed migrations at
    startup prevents a partially-created schema (such as a missing transit_routes
    table) from turning requests into 500 responses. SQLite tests remain isolated.
    """
    is_postgres = settings.database_url.lower().startswith(("postgresql", "postgres://"))
    if not is_postgres or not _env_enabled("AUTO_MIGRATE_ON_STARTUP", True):
        return

    print("[startup] Applying database migrations (alembic upgrade head)…", flush=True)
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(BACKEND_DIR), check=True, timeout=240,
    )

    if not _env_enabled("AUTO_SEED_DEMO_DATA", True):
        return

    # Seed only when a core table is empty. The seeder is idempotent and removes only
    # its own synthetic rows, preserving imported/real records. This covers newly
    # provisioned databases and deployments where initial seeding was skipped.
    from sqlalchemy import text as sql_text
    required_counts = ("transit_routes", "aqi_observations", "traffic_observations", "signal_plans", "trips")
    tables = set(inspect(engine).get_table_names())
    missing = [table for table in required_counts if table not in tables]
    empty = []
    for table in required_counts:
        if table in tables:
            with engine.connect() as connection:
                count = connection.execute(sql_text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()
            if count == 0:
                empty.append(table)
    if missing:
        raise RuntimeError("Database schema is incomplete after migrations; missing tables: " + ", ".join(missing))
    if empty:
        print("[startup] Initializing sample workspace because core tables are empty: " + ", ".join(empty), flush=True)
        subprocess.run(
            [sys.executable, "scripts/seed_demo.py"], cwd=str(BACKEND_DIR),
            check=True, timeout=240,
        )



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is migration-managed; never use create_all in production. Migrate before
    # serving requests, and seed the synthetic workspace only if core tables are empty.
    _prepare_production_database()
    yield
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="UrbanSaarthi smart mobility, air-quality, transit and city operations API.",
    lifespan=lifespan,
    openapi_url="/openapi.json" if settings.app_env != "production" else None,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url="/redoc" if settings.app_env != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
    max_age=86400,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith(settings.api_v1_prefix) else "no-cache")
    return response


@app.get("/", tags=["Health"])
def root():
    return {"service": settings.app_name, "status": "running", "version": app.version, "api_prefix": settings.api_v1_prefix}


@app.get("/healthz", tags=["Health"])
def healthz():
    return {"status": "ok"}


@app.get("/readyz", tags=["Health"])
def readyz():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ready", "database": "reachable"}
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})


prefix = settings.api_v1_prefix.rstrip("/")
for route_module in (mobility, traffic, aqi, transit, signals, command_center, alerts, ticketing, analytics, admin, integrations, ingestion, predictions):
    app.include_router(route_module.router, prefix=prefix)
