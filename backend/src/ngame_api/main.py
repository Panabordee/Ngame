from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import time

from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from .config import Settings
from .database import Database
from .routers.auth import router as auth_router
from .routers.matches import router as matches_router
from .routers.puzzles import router as puzzles_router
from .routers.social import router as social_router
from .routers.admin import router as admin_router
from .rate_limit import InMemoryRateLimiter, RedisRateLimiter, safely_increment


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
    app.state.rate_limiter = (
        RedisRateLimiter(resolved_settings.redis_url)
        if resolved_settings.redis_url
        else InMemoryRateLimiter()
    )

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        if (
            request.method == "OPTIONS"
            or request.url.path == "/healthz"
            or request.url.path.startswith("/matches/internal/")
        ):
            return await call_next(request)
        client_ip = request.client.host if request.client else "unknown"
        window_seconds = 60
        bucket = int(time.time()) // window_seconds
        key = f"ngame:api-rate:{client_ip}:{bucket}"
        count = await safely_increment(app.state.rate_limiter, key, window_seconds + 1)
        if count > resolved_settings.api_rate_limit_per_minute:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again shortly."},
                headers={"Retry-After": str(window_seconds - int(time.time()) % window_seconds)},
            )
        return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
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
    app.include_router(matches_router)
    app.include_router(puzzles_router)
    app.include_router(social_router)
    app.include_router(admin_router)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, str]:
        async with resolved_database.sessions() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
