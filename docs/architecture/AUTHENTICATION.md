# Authentication architecture

## Supported login methods

The current API supports:

- Email/password registration and sign-in
- Google OpenID Connect sign-in

Authenticated account linking is a future feature; the API deliberately refuses to silently merge password and Google identities that share an email address.

Until an SMTP provider is configured, use Mailpit for development email and keep production email/password registration disabled. Google sign-in remains suitable for the initial production deployment.

## Service ownership

FastAPI is the only authentication authority. It owns users, credentials, external identities, and refresh sessions. Verification and password-reset tokens are planned but not implemented. Colyseus does not issue application credentials; it only verifies short-lived access JWTs issued by FastAPI.

## Browser flow

1. The browser signs in through FastAPI.
2. FastAPI returns a short-lived access JWT in the response body.
3. FastAPI sets an opaque refresh token in a `Secure`, `HttpOnly`, `SameSite=Lax` host-only cookie on `ngame-api.ce-nacl.com`.
4. The browser keeps the access JWT in memory, not local storage.
5. The browser assigns the access JWT to the Colyseus client before matchmaking.
6. Colyseus verifies the signature, issuer, audience, expiry, and token type before accepting the room join.
7. Colyseus uses the JWT `sub` claim as the player identity. Connection/session IDs never replace the authenticated user ID.

On a browser refresh, the frontend obtains a new access JWT through the refresh cookie. Refresh tokens rotate on every use; only their hashes are stored in PostgreSQL.

## Google sign-in

Use the authorization-code OpenID Connect flow with FastAPI as the callback handler. Validate `state`, issuer, audience, signature, expiry, and nonce. Request only `openid email profile` scopes.

Required Google Console values for production:

```text
Authorized JavaScript origin:
https://ngame.ce-nacl.com

Authorized redirect URI:
https://ngame-api.ce-nacl.com/auth/google/callback
```

Identify a Google login by the stable provider subject (`sub`), never by display name. Do not silently attach a Google identity to an existing password account merely because email strings match. Require authenticated account linking when an existing identity would be affected.

## Current API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an email/password account |
| `POST` | `/auth/login` | Authenticate email/password |
| `POST` | `/auth/refresh` | Rotate refresh token and return access JWT |
| `POST` | `/auth/logout` | Revoke refresh session and clear cookie |
| `GET` | `/auth/google/start` | Begin Google OIDC flow |
| `GET` | `/auth/google/callback` | Complete Google OIDC flow |
| `GET` | `/auth/me` | Return the authenticated profile |

Planned endpoints are `/auth/verify-email`, `/auth/forgot-password`, and `/auth/reset-password`. Production email auth stays disabled until those flows and SMTP delivery exist.

Return generic login/reset errors so the API does not reveal whether an email address exists.

## Database entities

- `users`: stable user ID, display name, status, timestamps
- `auth_identities`: provider (`password` or `google`), provider subject, normalized email
- `password_credentials`: user ID and Argon2id hash
- `refresh_sessions`: token hash, user ID, expiry, rotation chain, revocation metadata

The current migration contains the first four entities. Email verification, password reset, matches, and match-player records require later migrations.

## Security baseline

- Hash passwords with Argon2id.
- Sign access JWTs asymmetrically; mount private/public keys as Docker secrets.
- Room actions are rate-limited now. Add distributed rate limits for registration, login, refresh, password reset, and matchmaking before public launch.
- Accept CORS credentials only from the exact frontend origin.
- Set `Secure` cookies in production and never log tokens, passwords, authorization codes, or client secrets.
- Keep Google client secrets and JWT private keys outside the repository.
