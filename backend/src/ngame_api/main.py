from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from .config import Settings
from .database import Database
from .routers.auth import router as auth_router


def create_app(settings: Settings | None = None, database: Database | None = None) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_database = database or Database(resolved_settings.database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await resolved_database.dispose()

    app = FastAPI(title="NGAME API", version="0.1.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.database = resolved_database

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=resolved_settings.oauth_state_secret,
        https_only=resolved_settings.cookie_secure,
        same_site="lax",
    )

    oauth = OAuth()
    if resolved_settings.google_auth_enabled:
        oauth.register(
            name="google",
            client_id=resolved_settings.google_client_id,
            client_secret=resolved_settings.google_client_secret,
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )
    app.state.oauth = oauth

    app.include_router(auth_router)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, str]:
        async with resolved_database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
