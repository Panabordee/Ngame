from fastapi.testclient import TestClient
import pytest

from ngame_api.services import IdentityConflictError, authenticate_google_user


REGISTRATION = {
    "email": "player@example.com",
    "password": "correct-horse-battery-staple",
    "display_name": "Cipher Player",
}


def register(client: TestClient):
    return client.post("/auth/register", json=REGISTRATION)


def test_health_and_disabled_google_route(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/auth/google/start").status_code == 404


def test_register_returns_access_token_refresh_cookie_and_profile(client: TestClient) -> None:
    response = register(client)
    assert response.status_code == 201
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] == 900
    assert payload["user"]["email"] == "player@example.com"
    assert payload["user"]["display_name"] == "Cipher Player"
    assert "ngame_refresh" in client.cookies
    assert "HttpOnly" in response.headers["set-cookie"]

    profile = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {payload['access_token']}"}
    )
    assert profile.status_code == 200
    assert profile.json()["id"] == payload["user"]["id"]


def test_duplicate_registration_and_generic_invalid_login(client: TestClient) -> None:
    assert register(client).status_code == 201
    assert register(client).status_code == 409

    missing = client.post(
        "/auth/login",
        json={"email": "missing@example.com", "password": "wrong-password"},
    )
    wrong = client.post(
        "/auth/login",
        json={"email": "player@example.com", "password": "wrong-password"},
    )
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert missing.json() == wrong.json()


def test_login_is_case_insensitive_and_refresh_token_rotates(client: TestClient) -> None:
    assert register(client).status_code == 201
    login = client.post(
        "/auth/login",
        json={
            "email": "PLAYER@EXAMPLE.COM",
            "password": REGISTRATION["password"],
        },
    )
    assert login.status_code == 200
    old_refresh = client.cookies["ngame_refresh"]

    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    assert client.cookies["ngame_refresh"] != old_refresh
    assert refreshed.json()["access_token"] != login.json()["access_token"]

    client.cookies.set("ngame_refresh", old_refresh, path="/auth")
    rejected = client.post("/auth/refresh")
    assert rejected.status_code == 401


def test_logout_revokes_refresh_session(client: TestClient) -> None:
    assert register(client).status_code == 201
    assert client.post("/auth/logout").status_code == 200
    assert client.post("/auth/refresh").status_code == 401


def test_rejects_missing_and_tampered_access_tokens(client: TestClient) -> None:
    response = register(client)
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

    blocked_refresh = client.post(
        "/auth/refresh", headers={"Origin": "https://attacker.example"}
    )
    assert blocked_refresh.status_code == 403


@pytest.mark.asyncio
async def test_google_identity_is_stable_and_does_not_silently_link_email(
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
                settings=settings,
                user_agent="test",
                ip_address="127.0.0.1",
            )
        await session.rollback()
