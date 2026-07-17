# Environment configuration

Copy `.env.example` to `.env` for Docker Compose. Never commit `.env` or `secrets/`.

## URLs and network exposure

| Variable | Local Compose default | Production value/purpose |
| --- | --- | --- |
| `FRONTEND_PUBLIC_URL` | `http://localhost:8080` | `https://ngame.ce-nacl.com` |
| `API_PUBLIC_URL` | `http://localhost:8000` | `https://api.ngame.ce-nacl.com` |
| `REALTIME_PUBLIC_URL` | `http://localhost:2567` | `https://realtime.ngame.ce-nacl.com` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | exact frontend origin; comma-separated if needed |
| `VITE_API_URL` | `http://localhost:8000` | build-time API URL for direct Vite builds |
| `VITE_REALTIME_URL` | `http://localhost:2567` | build-time realtime URL for direct Vite builds |
| `PUBLISH_ADDRESS` | `127.0.0.1` | bind address for public Compose ports |
| `FRONTEND_PORT` | `8080` | frontend host port |
| `API_PORT` | `8000` | API host port |
| `REALTIME_PORT` | `2567` | realtime host port |
| `REALTIME_HOST` | `0.0.0.0` | realtime listen address inside its container |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | trusted Nginx proxy IP for forwarded headers |

## Database and Redis

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` | PostgreSQL database name |
| `POSTGRES_USER` | PostgreSQL role |
| `POSTGRES_PASSWORD` | unique high-entropy password |
| `DATABASE_URL` | SQLAlchemy async URL; Compose overrides the host to `postgres` |
| `REDIS_URL` | reserved for matchmaking/rate-limit/snapshot work |

PostgreSQL and Redis stay on the internal Compose network and have no published ports.

## Access and refresh tokens

| Variable | Purpose |
| --- | --- |
| `JWT_PRIVATE_KEY_FILE` | RS256 private PEM used only by FastAPI |
| `JWT_PUBLIC_KEY_FILE` | public PEM used by FastAPI and Colyseus |
| `JWT_ISSUER` | exact expected `iss` claim; production API URL |
| `JWT_AUDIENCE` | expected `aud`, currently `ngame` |
| `ACCESS_TOKEN_TTL_SECONDS` | short-lived access token lifetime, default 900 |
| `REFRESH_TOKEN_TTL_DAYS` | refresh-session lifetime, default 30 |
| `REFRESH_COOKIE_NAME` | host-only HttpOnly refresh cookie name |
| `COOKIE_SECURE` | must be `true` in production HTTPS |

Generate a unique RSA key pair per environment. The private key must never be mounted into the realtime or frontend containers.

## Authentication providers

| Variable | Purpose |
| --- | --- |
| `OAUTH_STATE_SECRET` | unique random secret for OAuth state/session signing |
| `GOOGLE_AUTH_ENABLED` | enables Google endpoints after credentials are configured |
| `GOOGLE_CLIENT_ID` | Google OIDC client ID |
| `GOOGLE_CLIENT_SECRET` | Google OIDC client secret |
| `GOOGLE_REDIRECT_URI` | exact FastAPI callback URI |
| `EMAIL_AUTH_ENABLED` | local password registration/login flag |
| `EMAIL_VERIFICATION_REQUIRED` | must be true if production email auth is enabled |
| `SMTP_*` | reserved SMTP settings; Mailpit defaults are development-only |

The current API does not yet send verification or reset email, so production email auth must remain disabled.

## Realtime behavior

| Variable | Purpose |
| --- | --- |
| `RECONNECT_TIMEOUT_SECONDS` | room-wide pause/reconnect grace, default 30 |
| `MAX_ROOM_MESSAGES_PER_SECOND` | per-client Colyseus message limit, default 20 |
| `REALTIME_INTERNAL_TOKEN` | reserved for the future match-result API |

`NGAME_ENV=production` activates stricter startup validation. `LOG_LEVEL` is documented for the deployment environment; structured application logging configuration remains future work.
