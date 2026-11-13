from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.api import admin, agent, alerts, analytics, aqi, aqi_vision, air_intelligence, command_center, ingestion, integrations, mobility, predictions, signals, ticketing, traffic, traffic_detection, transit
from app.core.config import settings
from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Intentionally do not call Base.metadata.create_all() here. All schema changes go
    # through Alembic revision files so deployments and schema versions stay controlled.
    yield
    engine.dispose()


api = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="UrbanSaarthi smart mobility, air-quality, transit and city operations API.",
    lifespan=lifespan,
    openapi_url="/openapi.json" if settings.app_env != "production" else None,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url="/redoc" if settings.app_env != "production" else None,
)


@api.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cache-Control", "no-store" if request.url.path.startswith(settings.api_v1_prefix) else "no-cache")
    return response


@api.get("/", tags=["Health"])
def root():
    static_index = Path(__file__).resolve().parent / "static" / "index.html"
    if static_index.is_file():
        return FileResponse(static_index)
    return {"service": settings.app_name, "status": "running", "version": api.version, "api_prefix": settings.api_v1_prefix}


@api.get("/healthz", tags=["Health"])
def healthz():
    return {"status": "ok"}


@api.get("/readyz", tags=["Health"])
def readyz():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ready", "database": "reachable"}
    except SQLAlchemyError:
        return JSONResponse(status_code=503, content={"status": "not_ready", "database": "unavailable"})


prefix = settings.api_v1_prefix.rstrip("/")
for route_module in (agent, mobility, traffic, traffic_detection, air_intelligence, aqi, aqi_vision, transit, signals, command_center, alerts, ticketing, analytics, admin, integrations, ingestion, predictions):
    api.include_router(route_module.router, prefix=prefix)

# When deployed as a single Cloud Run service, FastAPI serves the Vite build too.
# Serve real asset files directly and send client-side routes to index.html. Keep
# unknown API paths as JSON 404s instead of accidentally returning the SPA shell.
STATIC_DIR = Path(__file__).resolve().parent / "static"


@api.api_route("/{asset_path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], include_in_schema=False)
def spa_fallback(asset_path: str, request: Request):
    api_prefix = settings.api_v1_prefix.rstrip("/")
    if asset_path == api_prefix.lstrip("/") or asset_path.startswith(api_prefix.lstrip("/") + "/"):
        raise HTTPException(status_code=404, detail="API route not found.")
    if request.method not in {"GET", "HEAD"}:
        raise HTTPException(status_code=404, detail="Route not found.")
    index_file = STATIC_DIR / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="Page not found.")
    candidate = (STATIC_DIR / asset_path).resolve()
    try:
        candidate.relative_to(STATIC_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(index_file)

# Keep CORS outside FastAPI's exception middleware. This ensures even framework
# errors and preflight responses receive the correct Access-Control headers.
# The production allow-list is intentionally exact and comes from CORS_ORIGINS.
# The production Vercel origin is a code-level trusted origin as well as an
# environment setting. This prevents a missing / stale Render CORS_ORIGINS value
# from silently breaking every browser request after a deploy.
PUBLIC_FRONTEND_ORIGIN = "https://urbansarthi.vercel.app"
trusted_origins = list(settings.cors_origin_list)
if PUBLIC_FRONTEND_ORIGIN not in trusted_origins:
    trusted_origins.append(PUBLIC_FRONTEND_ORIGIN)

app = CORSMiddleware(
    app=api,
    allow_origins=trusted_origins,
    allow_credentials=False,
    allow_methods=["*"],
    # This is a public API (no cookie authentication). Wildcard request headers
    # avoid brittle preflight failures when a browser adds a harmless header.
    allow_headers=["*"],
    expose_headers=["Retry-After"],
    max_age=600,
)

# Keep FastAPI dependency overrides accessible to the existing test harness and diagnostics.
app.dependency_overrides = api.dependency_overrides
