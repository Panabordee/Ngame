from functools import cached_property

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    ngame_env: str = "development"
    log_level: str = "info"

    frontend_public_url: str = "http://localhost:5173"
    api_public_url: str = "http://localhost:8000"
    realtime_public_url: str = "http://localhost:2567"
    cors_allowed_origins: str = "http://localhost:5173"

    database_url: str = "sqlite+aiosqlite:///./ngame.db"

    jwt_private_key_file: str = "secrets/jwt-private.pem"
    jwt_public_key_file: str = "secrets/jwt-public.pem"
    jwt_issuer: str = "http://localhost:8000"
    jwt_audience: str = "ngame"
    access_token_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    guest_session_ttl_seconds: int = Field(default=21600, ge=900, le=43200)
    refresh_token_ttl_days: int = Field(default=30, ge=1, le=180)
    refresh_cookie_name: str = "ngame_refresh"
    cookie_secure: bool = False

    oauth_state_secret: str = "replace-this-development-oauth-state-secret"
    google_auth_enabled: bool = False
    guest_auth_enabled: bool = True
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    @cached_property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.ngame_env.casefold() == "production"

    @model_validator(mode="after")
    def validate_security_settings(self) -> "Settings":
        if "*" in self.allowed_origins:
            raise ValueError("credentialed CORS cannot use a wildcard origin")
        if self.google_auth_enabled:
            if (
                not self.google_client_id
                or not self.google_client_secret
                or self.google_client_id.startswith("replace-")
                or self.google_client_secret.startswith("replace-")
            ):
                raise ValueError("Google auth requires a real client ID and client secret")
            if self.oauth_state_secret.startswith("replace-") or len(
                self.oauth_state_secret
            ) < 32:
                raise ValueError("Google auth requires a unique OAuth state secret")
        if self.is_production:
            if not self.cookie_secure:
                raise ValueError("production cookies must be secure")
            if self.oauth_state_secret.startswith("replace-"):
                raise ValueError("production requires a unique OAuth state secret")
            if not self.google_auth_enabled:
                raise ValueError("production requires Google authentication")
        return self
