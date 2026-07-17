import asyncio
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from ngame_api.config import Settings
from ngame_api.database import Base, Database
from ngame_api.main import create_app


def _write_test_keys(directory: Path) -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_path = directory / "jwt-private.pem"
    public_path = directory / "jwt-public.pem"
    private_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return str(private_path), str(public_path)


async def _create_schema(database: Database) -> None:
    async with database.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    private_key, public_key = _write_test_keys(tmp_path)
    return Settings(
        _env_file=None,
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        jwt_private_key_file=private_key,
        jwt_public_key_file=public_key,
        jwt_issuer="http://testserver",
        jwt_audience="ngame-test",
        frontend_public_url="http://frontend.test",
        cors_allowed_origins="http://frontend.test",
        cookie_secure=False,
        email_auth_enabled=True,
        email_verification_required=False,
        google_auth_enabled=False,
        oauth_state_secret="test-state-secret-that-is-long-enough",
    )


@pytest.fixture
def client(settings: Settings):
    database = Database(settings.database_url)
    asyncio.run(_create_schema(database))
    app = create_app(settings, database)
    with TestClient(app) as test_client:
        yield test_client
