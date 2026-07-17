# Google-only authentication

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

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/auth/google/start` | start Google OAuth |
| `GET` | `/auth/google/callback` | validate Google and create a session |
| `POST` | `/auth/refresh` | rotate refresh session and issue access JWT |
| `POST` | `/auth/logout` | revoke the current refresh session and clear cookie |
| `GET` | `/auth/me` | return the authenticated profile |
| `PATCH` | `/auth/me` | update display name and unique username |

There are no password registration or login endpoints.

## Stored data

- `users`: display name, normalized unique username, Google avatar URL, and account status
- `auth_identities`: unique Google subject, unique normalized verified email, provider
- `refresh_sessions`: hashed opaque token, expiry, revocation, rotation link, client metadata

Migration `20260717_0002` deletes all legacy password users and their refresh sessions, then drops `password_credentials`. Downgrading recreates the empty table but cannot restore deleted accounts.

Migration `20260717_0004` adds the editable username and Google-avatar profile fields. Usernames are 3–20 ASCII letters, numbers, or underscores and are stored case-folded.

## Security requirements

- Use exact CORS origins; never `*` with credentials.
- Keep Google secret, OAuth state secret, refresh tokens, and JWT private key out of logs and Git.
- Mount the private JWT key only into the API container.
- Keep access JWTs short-lived and refresh cookies `Secure` in production.
- Add distributed limits for OAuth start/callback, refresh, and matchmaking before a public launch.
