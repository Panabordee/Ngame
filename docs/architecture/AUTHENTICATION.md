# Google and one-match Guest authentication

FastAPI is the authentication authority. NGAME never receives a Google password.

## Browser flow

1. The client opens `GET /auth/google/start`.
2. FastAPI starts Google OpenID Connect with `openid email profile` and a signed state cookie.
3. Google returns to `GET /auth/google/callback`.
4. FastAPI validates the provider response and requires a verified email.
5. FastAPI stores the stable Google `sub`, user profile, and a hashed refresh-session token.
6. The browser receives the opaque refresh token in a host-only `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production).
7. `POST /auth/refresh` rotates that cookie and returns a short-lived RS256 access JWT.
8. The browser sends the access JWT to Colyseus; realtime verifies issuer, audience, type, signature, expiry, and the server-issued `name` display claim.

## Guest flow

1. The client sends an optional display name to `POST /auth/guest`.
2. FastAPI returns a signed RS256 access JWT with `account_type=guest`, a random `sub`, and a separate `guest_session_id`.
3. No user, identity, or refresh-session row is created. The response is `no-store` and no cookie is set.
4. The browser keeps the Guest credential only in that tab's `sessionStorage` for up to `GUEST_SESSION_TTL_SECONDS`.
5. Realtime reserves the Guest session for its first room. Leaving before the host starts releases the reservation; starting commits it for that JWT, so it cannot enter a second match.
6. The client stores the Colyseus reconnection token in the same tab so a reload can return to the committed match during the reconnect window.
7. At game end or sign-out, the browser removes the Guest credential. Guests cannot edit profiles or call authenticated database endpoints.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/auth/google/start` | start Google OAuth |
| `GET` | `/auth/google/callback` | validate Google and create a session |
| `POST` | `/auth/guest` | issue an ephemeral one-match Guest JWT |
| `POST` | `/auth/refresh` | rotate refresh session and issue access JWT |
| `POST` | `/auth/logout` | revoke the current refresh session and clear cookie |
| `GET` | `/auth/me` | return the authenticated profile |
| `PATCH` | `/auth/me` | update display name and unique username |

There are no password registration or login endpoints.

## Stored data

- `users`: display name, normalized unique username, Google avatar URL, and account status
- `auth_identities`: unique Google subject, unique normalized verified email, provider
- `refresh_sessions`: hashed opaque token, expiry, revocation, rotation link, client metadata

Guest authentication stores none of these rows. Its identity and expiry are carried in the signed JWT; live one-match room binding belongs to the realtime process.

Migration `20260717_0002` deletes all legacy password users and their refresh sessions, then drops `password_credentials`. Downgrading recreates the empty table but cannot restore deleted accounts.

Migration `20260717_0004` adds the editable username and Google-avatar profile fields. Usernames are 3–20 ASCII letters, numbers, or underscores and are stored case-folded.

## Security requirements

- Use exact CORS origins; never `*` with credentials.
- Keep Google secret, OAuth state secret, refresh tokens, and JWT private key out of logs and Git.
- Mount the private JWT key only into the API container.
- Keep access JWTs short-lived and refresh cookies `Secure` in production.
- Guest JWTs must include `account_type=guest`, `guest_session_id`, and expiry. Realtime never trusts a client-supplied player ID or display name.
- The current in-memory Guest binding matches the single realtime instance. Multi-replica deployment requires a distributed Colyseus matchmaker and shared atomic Guest registry.
- Add distributed limits for OAuth start/callback, refresh, and matchmaking before a public launch.
