import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import jwt
from jwt import InvalidTokenError

from .config import Settings


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def create_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@lru_cache(maxsize=8)
def _read_key(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def create_access_token(user_id: UUID, settings: Settings) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
        "jti": str(uuid4()),
        "typ": "access",
    }
    return jwt.encode(
        payload,
        _read_key(settings.jwt_private_key_file),
        algorithm="RS256",
    )


def decode_access_token(token: str, settings: Settings) -> UUID:
    try:
        payload = jwt.decode(
            token,
            _read_key(settings.jwt_public_key_file),
            algorithms=["RS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "iss", "aud", "iat", "exp", "jti", "typ"]},
        )
        if payload.get("typ") != "access":
            raise InvalidTokenError("invalid token type")
        return UUID(payload["sub"])
    except (InvalidTokenError, ValueError, TypeError, KeyError) as exc:
        raise ValueError("invalid access token") from exc
