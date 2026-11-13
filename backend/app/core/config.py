from functools import lru_cache
from pydantic import model_validator
from urllib.parse import urlparse
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False)

    app_name: str = "UrbanSaarthi API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./urbansaarthi.db"
    timezone: str = "Asia/Kolkata"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    osrm_base_url: str = ""
    openaq_api_key: str = ""
    # Server-side OpenWeather credential. Never expose this value in frontend env or responses.
    weather_api_key: str = ""
    tomtom_api_key: str = ""
    model_path: str = ""
    # Google AI is optional: deterministic workflows remain available without credentials.
    gemini_api_key: str = ""
    google_ai_primary_model: str = "gemini-3.8-flash"
    google_ai_fallback_model: str = "gemma-4-26b-a4b-it"
    google_ai_timeout_seconds: int = 12
    # Optional override for the bundled YOLO traffic checkpoint.
    traffic_model_path: str = ""
    sumo_binary: str = ""
    ingestion_api_key: str = ""
    gtfs_max_upload_mb: int = 30
    auto_refresh_forecasts: bool = True
    forecast_refresh_min_interval_seconds: int = 300

    @model_validator(mode="before")
    @classmethod
    def normalize_postgres_driver(cls, values):
        """Render and many managed Postgres hosts supply postgres:// or postgresql:// URLs.

        This project installs psycopg v3, so normalize those aliases to its explicit
        SQLAlchemy dialect before the engine and Alembic read the setting.
        """
        if isinstance(values, dict):
            url = str(values.get("database_url") or values.get("DATABASE_URL") or "").strip()
            if url.startswith("postgres://"):
                values["database_url"] = "postgresql+psycopg://" + url[len("postgres://"):]
            elif url.startswith("postgresql://"):
                values["database_url"] = "postgresql+psycopg://" + url[len("postgresql://"):]
        return values

    @property
    def cors_origin_list(self) -> list[str]:
        origins: list[str] = []
        for item in self.cors_origins.split(","):
            origin = item.strip().rstrip("/")
            if origin and origin not in origins:
                origins.append(origin)
        return origins

    @model_validator(mode="after")
    def validate_production_security(self):
        if self.app_env.lower() != "production":
            return self
        origins = self.cors_origin_list
        if not origins or "*" in origins:
            raise ValueError("Production CORS_ORIGINS must list explicit frontend origins; wildcard is not allowed")
        for origin in origins:
            parsed = urlparse(origin)
            if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
                raise ValueError("Every production CORS_ORIGINS entry must be an exact HTTPS origin without a path")
        if self.database_url.lower().startswith("sqlite"):
            raise ValueError("Production deployments must use PostgreSQL; SQLite is for local development and tests")
        # Human login has been removed from this public hackathon release.
        # Device ingestion remains protected by its own high-entropy key.
        if len(self.ingestion_api_key) < 32:
            raise ValueError("Production deployments must set INGESTION_API_KEY to at least 32 characters for edge devices.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
