from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings
from ..dependencies import get_current_profile, get_session, get_settings
from ..models import AuthIdentity, User
from ..schemas import AuthResponse, LoginRequest, MessageResponse, RegisterRequest, UserResponse
from ..services import (
    AuthenticationError,
    IdentityConflictError,
    SessionTokens,
    authenticate_google_user,
    authenticate_password_user,
    register_password_user,
    revoke_refresh_session,
    rotate_refresh_session,
)


router = APIRouter(prefix="/auth", tags=["authentication"])


def _require_trusted_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in settings.allowed_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin is not allowed.",
        )


def _client_metadata(request: Request) -> tuple[str | None, str | None]:
    user_agent = request.headers.get("user-agent")
    ip_address = request.client.host if request.client else None
    return user_agent, ip_address


def _set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        path="/auth",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path="/auth",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _auth_response(tokens: SessionTokens, settings: Settings) -> AuthResponse:
    return AuthResponse(
        access_token=tokens.access_token,
        expires_in=settings.access_token_ttl_seconds,
        user=UserResponse(
            id=tokens.user.id,
            display_name=tokens.user.display_name,
            email=tokens.identity.email,
            email_verified=tokens.identity.email_verified,
        ),
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthResponse:
    _require_trusted_origin(request, settings)
    if not settings.email_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    user_agent, ip_address = _client_metadata(request)
    try:
        tokens = await register_password_user(
            session,
            str(body.email),
            body.password,
            body.display_name,
            settings,
            user_agent,
            ip_address,
        )
        await session.commit()
    except IdentityConflictError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to create account.",
        ) from None
    _set_refresh_cookie(response, tokens.refresh_token, settings)
    return _auth_response(tokens, settings)


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthResponse:
    _require_trusted_origin(request, settings)
    if not settings.email_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    user_agent, ip_address = _client_metadata(request)
    try:
        tokens = await authenticate_password_user(
            session,
            str(body.email),
            body.password,
            settings,
            user_agent,
            ip_address,
        )
        await session.commit()
    except AuthenticationError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from None
    _set_refresh_cookie(response, tokens.refresh_token, settings)
    return _auth_response(tokens, settings)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthResponse:
    _require_trusted_origin(request, settings)
    raw_token = request.cookies.get(settings.refresh_cookie_name)
    if raw_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        )
    user_agent, ip_address = _client_metadata(request)
    try:
        tokens = await rotate_refresh_session(
            session, raw_token, settings, user_agent, ip_address
        )
        await session.commit()
    except AuthenticationError:
        await session.rollback()
        _clear_refresh_cookie(response, settings)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        ) from None
    _set_refresh_cookie(response, tokens.refresh_token, settings)
    return _auth_response(tokens, settings)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    _require_trusted_origin(request, settings)
    raw_token = request.cookies.get(settings.refresh_cookie_name)
    if raw_token is not None:
        await revoke_refresh_session(session, raw_token)
        await session.commit()
    _clear_refresh_cookie(response, settings)
    return MessageResponse(message="Signed out.")


@router.get("/me", response_model=UserResponse)
async def me(
    profile: Annotated[tuple[User, AuthIdentity], Depends(get_current_profile)],
) -> UserResponse:
    user, identity = profile
    return UserResponse(
        id=user.id,
        display_name=user.display_name,
        email=identity.email,
        email_verified=identity.email_verified,
    )


@router.get("/google/start")
async def google_start(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
):
    if not settings.google_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    return await request.app.state.oauth.google.authorize_redirect(
        request, settings.google_redirect_uri
    )


@router.get("/google/callback")
async def google_callback(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    if not settings.google_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    try:
        token = await request.app.state.oauth.google.authorize_access_token(request)
        user_info = token["userinfo"]
        user_agent, ip_address = _client_metadata(request)
        tokens = await authenticate_google_user(
            session,
            subject=user_info["sub"],
            email=user_info["email"],
            email_verified=bool(user_info.get("email_verified")),
            display_name=user_info.get("name") or "Player",
            settings=settings,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        await session.commit()
    except IdentityConflictError:
        await session.rollback()
        return RedirectResponse(
            f"{settings.frontend_public_url}/auth/callback?error=identity_conflict",
            status_code=status.HTTP_303_SEE_OTHER,
        )
    except (AuthenticationError, KeyError):
        await session.rollback()
        return RedirectResponse(
            f"{settings.frontend_public_url}/auth/callback?error=authentication_failed",
            status_code=status.HTTP_303_SEE_OTHER,
        )

    redirect = RedirectResponse(
        f"{settings.frontend_public_url}/auth/callback",
        status_code=status.HTTP_303_SEE_OTHER,
    )
    _set_refresh_cookie(redirect, tokens.refresh_token, settings)
    return redirect
