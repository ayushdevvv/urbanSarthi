from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.api import admin, alerts, analytics, aqi, command_center, ingestion, integrations, mobility, predictions, signals, ticketing, traffic, transit
from app.core.config import settings
from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Intentionally do not call Base.metadata.create_all() here. All schema changes go
    # through Alembic revision files so deployments and schema versions stay controlled.
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
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Ingestion-Key"],
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
