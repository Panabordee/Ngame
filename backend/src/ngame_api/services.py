from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .models import AuthIdentity, PasswordCredential, RefreshSession, User
from .security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    normalize_email,
    verify_password,
)


class AuthenticationError(Exception):
    pass


class IdentityConflictError(Exception):
    pass


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    user: User
    identity: AuthIdentity


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


async def _identity_by_provider(
    session: AsyncSession, provider: str, subject: str
) -> AuthIdentity | None:
    return await session.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_subject == subject,
        )
    )


async def _user_by_id(session: AsyncSession, user_id: UUID) -> User | None:
    return await session.get(User, user_id)


async def _new_session(
    session: AsyncSession,
    user: User,
    identity: AuthIdentity,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokens:
    refresh_token = create_refresh_token()
    session.add(
        RefreshSession(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.refresh_token_ttl_days),
            user_agent=user_agent,
            ip_address=ip_address,
        )
    )
    return SessionTokens(
        access_token=create_access_token(user.id, settings),
        refresh_token=refresh_token,
        user=user,
        identity=identity,
    )


async def register_password_user(
    session: AsyncSession,
    email: str,
    password: str,
    display_name: str,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokens:
    subject = normalize_email(email)
    if await _identity_by_provider(session, "password", subject) is not None:
        raise IdentityConflictError

    user = User(display_name=display_name)
    session.add(user)
    await session.flush()
    identity = AuthIdentity(
        user_id=user.id,
        provider="password",
        provider_subject=subject,
        email=subject,
        email_verified=not settings.email_verification_required,
    )
    session.add_all(
        [identity, PasswordCredential(user_id=user.id, password_hash=hash_password(password))]
    )
    await session.flush()
    return await _new_session(
        session, user, identity, settings, user_agent, ip_address
    )


async def authenticate_password_user(
    session: AsyncSession,
    email: str,
    password: str,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokens:
    subject = normalize_email(email)
    identity = await _identity_by_provider(session, "password", subject)
    credential = (
        await session.get(PasswordCredential, identity.user_id)
        if identity is not None
        else None
    )
    if not verify_password(password, credential.password_hash if credential else None):
        raise AuthenticationError
    if identity is None:
        raise AuthenticationError
    user = await _user_by_id(session, identity.user_id)
    if user is None or user.status != "active":
        raise AuthenticationError
    return await _new_session(
        session, user, identity, settings, user_agent, ip_address
    )


async def rotate_refresh_session(
    session: AsyncSession,
    raw_token: str,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokens:
    stored = await session.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_hash == hash_refresh_token(raw_token))
        .with_for_update()
    )
    now = datetime.now(timezone.utc)
    if stored is None or stored.revoked_at is not None or _as_utc(stored.expires_at) <= now:
        raise AuthenticationError
    user = await _user_by_id(session, stored.user_id)
    if user is None or user.status != "active":
        raise AuthenticationError
    identity = await session.scalar(
        select(AuthIdentity)
        .where(AuthIdentity.user_id == user.id)
        .order_by(AuthIdentity.created_at)
    )
    if identity is None:
        raise AuthenticationError

    tokens = await _new_session(
        session, user, identity, settings, user_agent, ip_address
    )
    await session.flush()
    replacement = await session.scalar(
        select(RefreshSession).where(
            RefreshSession.token_hash == hash_refresh_token(tokens.refresh_token)
        )
    )
    stored.revoked_at = now
    stored.replaced_by_id = replacement.id if replacement else None
    return tokens


async def revoke_refresh_session(session: AsyncSession, raw_token: str) -> None:
    stored = await session.scalar(
        select(RefreshSession).where(
            RefreshSession.token_hash == hash_refresh_token(raw_token)
        )
    )
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = datetime.now(timezone.utc)


async def user_profile(
    session: AsyncSession, user_id: UUID
) -> tuple[User, AuthIdentity] | None:
    user = await _user_by_id(session, user_id)
    if user is None or user.status != "active":
        return None
    identity = await session.scalar(
        select(AuthIdentity)
        .where(AuthIdentity.user_id == user_id)
        .order_by(AuthIdentity.created_at)
    )
    return (user, identity) if identity is not None else None


async def authenticate_google_user(
    session: AsyncSession,
    subject: str,
    email: str,
    email_verified: bool,
    display_name: str,
    settings: Settings,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokens:
    if not email_verified:
        raise AuthenticationError
    identity = await _identity_by_provider(session, "google", subject)
    if identity is None:
        normalized = normalize_email(email)
        collision = await session.scalar(
            select(AuthIdentity).where(AuthIdentity.email == normalized)
        )
        if collision is not None:
            raise IdentityConflictError
        user = User(display_name=display_name[:32] or "Player")
        session.add(user)
        await session.flush()
        identity = AuthIdentity(
            user_id=user.id,
            provider="google",
            provider_subject=subject,
            email=normalized,
            email_verified=True,
        )
        session.add(identity)
        await session.flush()
    else:
        user = await _user_by_id(session, identity.user_id)
        if user is None or user.status != "active":
            raise AuthenticationError
    return await _new_session(
        session, user, identity, settings, user_agent, ip_address
    )
