from types import SimpleNamespace

from authlib.integrations.base_client.errors import OAuthError
from fastapi.testclient import TestClient
import pytest

from ngame_api.services import IdentityConflictError, authenticate_google_user


GOOGLE_USER = {
    "sub": "google-subject-1",
    "email": "google@example.com",
    "email_verified": True,
    "name": "Google Player",
    "picture": "https://images.example/google-player.png",
}


class SuccessfulGoogleClient:
    def __init__(self, user_info: dict[str, object] | None = None) -> None:
        self.user_info = user_info or GOOGLE_USER

    async def authorize_access_token(self, _request):
        return {"userinfo": self.user_info}


def configure_google(client: TestClient, google_client: object) -> None:
    client.app.state.settings.google_auth_enabled = True
    client.app.state.oauth = SimpleNamespace(google=google_client)


def complete_google_login(client: TestClient):
    configure_google(client, SuccessfulGoogleClient())
    callback = client.get("/auth/google/callback", follow_redirects=False)
    assert callback.status_code == 303
    assert callback.headers["location"] == "http://frontend.test/auth/callback"
    assert "ngame_refresh" in client.cookies
    assert "HttpOnly" in callback.headers["set-cookie"]
    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    return refreshed


def test_health_disabled_google_and_removed_password_routes(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/auth/google/start").status_code == 404
    assert client.post("/auth/register", json={}).status_code == 404
    assert client.post("/auth/login", json={}).status_code == 404


def test_google_callback_creates_session_access_token_and_profile(
    client: TestClient,
) -> None:
    response = complete_google_login(client)
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] == 900
    assert payload["user"]["email"] == "google@example.com"
    assert payload["user"]["display_name"] == "Google Player"
    assert payload["user"]["username"] is None
    assert payload["user"]["avatar_url"] == "https://images.example/google-player.png"

    profile = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {payload['access_token']}"}
    )
    assert profile.status_code == 200
    assert profile.json()["id"] == payload["user"]["id"]


def test_player_can_set_profile_and_username_must_be_unique(client: TestClient) -> None:
    first = complete_google_login(client)
    token = first.json()["access_token"]
    updated = client.patch(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        json={"display_name": "  Cipher   Fox  ", "username": "Cipher_Fox"},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Cipher Fox"
    assert updated.json()["username"] == "cipher_fox"

    client.cookies.clear()
    configure_google(
        client,
        SuccessfulGoogleClient(
            {
                "sub": "google-subject-2",
                "email": "second@example.com",
                "email_verified": True,
                "name": "Second Player",
            }
        ),
    )
    callback = client.get("/auth/google/callback", follow_redirects=False)
    assert callback.status_code == 303
    second = client.post("/auth/refresh")
    conflict = client.patch(
        "/auth/me",
        headers={"Authorization": f"Bearer {second.json()['access_token']}"},
        json={"display_name": "Second Player", "username": "CIPHER_FOX"},
    )
    assert conflict.status_code == 409


def test_profile_rejects_invalid_username(client: TestClient) -> None:
    response = complete_google_login(client)
    rejected = client.patch(
        "/auth/me",
        headers={"Authorization": f"Bearer {response.json()['access_token']}"},
        json={"display_name": "Player", "username": "not allowed!"},
    )
    assert rejected.status_code == 422


def test_refresh_token_rotates_and_old_token_is_rejected(client: TestClient) -> None:
    first = complete_google_login(client)
    old_refresh = client.cookies["ngame_refresh"]

    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    assert client.cookies["ngame_refresh"] != old_refresh
    assert refreshed.json()["access_token"] != first.json()["access_token"]

    client.cookies.set("ngame_refresh", old_refresh, path="/auth")
    rejected = client.post("/auth/refresh")
    assert rejected.status_code == 401


def test_logout_revokes_google_refresh_session(client: TestClient) -> None:
    complete_google_login(client)
    assert client.post("/auth/logout").status_code == 200
    assert client.post("/auth/refresh").status_code == 401


def test_rejects_missing_and_tampered_access_tokens(client: TestClient) -> None:
    response = complete_google_login(client)
    token = response.json()["access_token"]
    header, payload, signature = token.split(".")
    changed_prefix = "A" if signature[0] != "A" else "B"
    tampered = f"{header}.{payload}.{changed_prefix}{signature[1:]}"
    assert client.get("/auth/me").status_code == 401
    assert (
        client.get(
            "/auth/me", headers={"Authorization": f"Bearer {tampered}"}
        ).status_code
        == 401
    )


def test_cors_allows_only_the_configured_frontend(client: TestClient) -> None:
    allowed = client.options(
        "/auth/refresh",
        headers={
            "Origin": "http://frontend.test",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://frontend.test"

    blocked = client.options(
        "/auth/refresh",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in blocked.headers
    assert (
        client.post(
            "/auth/refresh", headers={"Origin": "https://attacker.example"}
        ).status_code
        == 403
    )


def test_google_callback_redirects_provider_errors_instead_of_returning_500(
    client: TestClient,
) -> None:
    class RejectingGoogleClient:
        async def authorize_access_token(self, _request):
            raise OAuthError(error="access_denied", description="User cancelled")

    configure_google(client, RejectingGoogleClient())
    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == (
        "http://frontend.test/auth/callback?error=authentication_failed"
    )


def test_google_callback_rejects_non_boolean_email_verification(
    client: TestClient,
) -> None:
    configure_google(
        client,
        SuccessfulGoogleClient(
            {
                "sub": "google-subject",
                "email": "google@example.com",
                "email_verified": "true",
                "name": "Google Player",
            }
        ),
    )
    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == (
        "http://frontend.test/auth/callback?error=authentication_failed"
    )


@pytest.mark.asyncio
async def test_google_identity_is_stable_and_rejects_email_collisions(
    client: TestClient,
) -> None:
    database = client.app.state.database
    settings = client.app.state.settings
    async with database.sessions() as session:
        first = await authenticate_google_user(
            session,
            subject="google-subject-1",
            email="google@example.com",
            email_verified=True,
            display_name="Google Player",
            avatar_url=None,
            settings=settings,
            user_agent="test",
            ip_address="127.0.0.1",
        )
        await session.commit()

    async with database.sessions() as session:
        returning = await authenticate_google_user(
            session,
            subject="google-subject-1",
            email="google@example.com",
            email_verified=True,
            display_name="Changed Provider Name",
            avatar_url=None,
            settings=settings,
            user_agent="test",
            ip_address="127.0.0.1",
        )
        assert returning.user.id == first.user.id
        with pytest.raises(IdentityConflictError):
            await authenticate_google_user(
                session,
                subject="different-google-subject",
                email="google@example.com",
                email_verified=True,
                display_name="Collision",
                avatar_url=None,
                settings=settings,
                user_agent="test",
                ip_address="127.0.0.1",
            )
        await session.rollback()
