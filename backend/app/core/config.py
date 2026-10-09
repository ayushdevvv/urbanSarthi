from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "UrbanSaarthi API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./urbansaarthi.db"
    timezone: str = "Asia/Kolkata"
    cors_origins: str = "https://urbansarthi.vercel.app,http://localhost:5173,http://localhost:3000"
    cors_origin_regex: str = r"https://[a-zA-Z0-9-]+\.vercel\.app"
    osrm_base_url: str = "https://router.project-osrm.org"
    openaq_api_key: str = ""
    model_path: str = ""
    gtfs_max_upload_mb: int = 30
    auto_refresh_forecasts: bool = True
    forecast_refresh_min_interval_seconds: int = 300

    @property
    def cors_origin_list(self) -> list[str]:
        # Always include the deployed SPA host, even when Render still has the old
        # localhost-only CORS_ORIGINS value configured. Custom domains can be added
        # through CORS_ORIGINS without editing code.
        configured = [item.strip().rstrip("/") for item in self.cors_origins.split(",") if item.strip()]
        configured.extend(["https://urbansarthi.vercel.app", "https://urbansaarthi.vercel.app"])
        return list(dict.fromkeys(configured))

    @model_validator(mode="after")
    def validate_production_security(self):
        if self.app_env.lower() != "production":
            return self
        origins = self.cors_origin_list
        if not origins or "*" in origins:
            raise ValueError("Production CORS_ORIGINS must list explicit frontend origins; wildcard is not allowed")
        if self.database_url.lower().startswith("sqlite"):
            raise ValueError("Production deployments must use PostgreSQL; SQLite is for local development and tests")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
