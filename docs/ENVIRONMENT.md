# Environment settings

Copy `.env.example` to `.env`; never commit `.env` or `secrets/`.

## Required application values

| Variable | Local Docker | Production |
| --- | --- | --- |
| `NGAME_ENV` | `development` | `production` |
| `FRONTEND_PUBLIC_URL` | `http://localhost:8080` | `https://ngame.ce-nacl.com` |
| `API_PUBLIC_URL` | `http://localhost:8000` | `https://ngame-api.ce-nacl.com` |
| `REALTIME_PUBLIC_URL` | `http://localhost:2567` | `https://ngame-realtime.ce-nacl.com` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | exact frontend origin |
| `PUBLISH_ADDRESS` | `127.0.0.1` | loopback or VM private IP |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | trusted Nginx private IP |

Compose publishes frontend `8080`, API `8000`, and realtime `2567`. PostgreSQL and Redis remain internal.

## Google-only authentication

| Variable | Purpose |
| --- | --- |
| `GOOGLE_AUTH_ENABLED` | must be `true` for sign-in; production refuses to start otherwise |
| `GOOGLE_CLIENT_ID` | real Google Web application client ID |
| `GOOGLE_CLIENT_SECRET` | real Google client secret |
| `GOOGLE_REDIRECT_URI` | exact FastAPI callback registered in Google |
| `OAUTH_STATE_SECRET` | unique random value of at least 32 characters |
| `COOKIE_SECURE` | `false` on localhost; `true` in production |
| `REFRESH_TOKEN_TTL_DAYS` | refresh-session lifetime |

Password signup/signin no longer exists. Migration `20260717_0002` deletes old password accounts and their sessions.

## JWT and data

| Variable | Purpose |
| --- | --- |
| `JWT_ISSUER` | API URL; must match API and realtime |
| `JWT_AUDIENCE` | shared audience, default `ngame` |
| `JWT_PRIVATE_KEY_FILE` | API-only private key Docker secret |
| `JWT_PUBLIC_KEY_FILE` | public key used by API and realtime |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL credentials |
| `DATABASE_URL` | overridden by Compose for the API container |
| `REDIS_URL` | reserved for distributed presence/matchmaking |
| `RECONNECT_TIMEOUT_SECONDS` | reconnect grace period, default `30` |
| `MAX_ROOM_MESSAGES_PER_SECOND` | per-client realtime limit, default `20` |

The realtime container receives only its JWT, CORS, and room settings; it does not receive Google or database secrets.
