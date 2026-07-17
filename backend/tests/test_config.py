import pytest
from pydantic import ValidationError

from ngame_api.config import Settings


def test_production_rejects_insecure_cookie_configuration() -> None:
    with pytest.raises(ValidationError, match="production cookies must be secure"):
        Settings(_env_file=None, ngame_env="production", cookie_secure=False)


def test_google_auth_requires_credentials() -> None:
    with pytest.raises(ValidationError, match="Google auth requires"):
        Settings(_env_file=None, google_auth_enabled=True)


def test_credentialed_cors_rejects_wildcard() -> None:
    with pytest.raises(ValidationError, match="wildcard"):
        Settings(_env_file=None, cors_allowed_origins="*")
