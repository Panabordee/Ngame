import pytest
from pydantic import ValidationError

from ngame_api.config import Settings


def test_production_rejects_insecure_cookie_configuration() -> None:
    with pytest.raises(ValidationError, match="production cookies must be secure"):
        Settings(_env_file=None, ngame_env="production", cookie_secure=False)


def test_google_auth_requires_credentials() -> None:
    with pytest.raises(ValidationError, match="Google auth requires"):
        Settings(_env_file=None, google_auth_enabled=True)


def test_google_auth_requires_a_real_state_secret() -> None:
    with pytest.raises(ValidationError, match="unique OAuth state secret"):
        Settings(
            _env_file=None,
            google_auth_enabled=True,
            google_client_id="test-client-id",
            google_client_secret="test-client-secret",
        )


def test_production_requires_google_authentication() -> None:
    with pytest.raises(ValidationError, match="requires Google authentication"):
        Settings(
            _env_file=None,
            ngame_env="production",
            cookie_secure=True,
            oauth_state_secret="a-unique-production-state-secret",
            google_auth_enabled=False,
        )


def test_credentialed_cors_rejects_wildcard() -> None:
    with pytest.raises(ValidationError, match="wildcard"):
        Settings(_env_file=None, cors_allowed_origins="*")
