# Local development

## One-time setup

Requirements: Node.js 24.18+, Python 3.12+, and OpenSSL. Redis is optional for a single-process local run and recommended when testing production-like multi-instance behavior.

```bash
npm ci
python -m venv .venv
source .venv/bin/activate
python -m pip install -e 'backend[dev]'
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
cd backend
DATABASE_URL=sqlite+aiosqlite:///../ngame.db alembic upgrade head
cd ..
```

Create a Google **Web application** OAuth client with:

- Authorized JavaScript origin: `http://localhost:5173`
- Redirect URI: `http://localhost:8000/auth/google/callback`

## Run three terminals

### What changed from the earlier local flow

- Run `alembic upgrade head` again after pulling. The latest migrations add match/social data and protected deck-theme administration.
- A plain three-terminal run still works: API rate limits, Guest bindings, account room reservations, and room codes fall back to process memory.
- For production-like behavior, start Redis and export the same `REDIS_URL` in the API and realtime terminals. This makes those registries and limits atomic across processes.
- Set `ADMIN_EMAILS` to a comma-separated list of verified Google emails only when deck administration is needed.
- The browser client is unchanged operationally, but mobile gameplay is landscape-first.

Optional Redis terminal:

```bash
docker run --name ngame-local-redis --rm -p 6379:6379 redis:7-alpine
```

API:

```bash
source .venv/bin/activate
export DATABASE_URL=sqlite+aiosqlite:///./ngame.db
export JWT_PRIVATE_KEY_FILE=secrets/jwt-private.pem
export JWT_PUBLIC_KEY_FILE=secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export FRONTEND_PUBLIC_URL=http://localhost:5173
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export COOKIE_SECURE=false
export GOOGLE_AUTH_ENABLED=true
export GUEST_AUTH_ENABLED=true
export GUEST_SESSION_TTL_SECONDS=21600
export GOOGLE_CLIENT_ID='your-google-client-id'
export GOOGLE_CLIENT_SECRET='your-google-client-secret'
export GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
export OAUTH_STATE_SECRET='replace-with-at-least-32-random-characters'
export REDIS_URL=redis://127.0.0.1:6379 # optional
export API_RATE_LIMIT_PER_MINUTE=120
export ADMIN_EMAILS='your-admin-google-email@example.com' # optional
uvicorn ngame_api.main:app --app-dir backend/src --host 127.0.0.1 --port 8000
```

Realtime:

```bash
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export JWT_AUDIENCE=ngame
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export REDIS_URL=redis://127.0.0.1:6379 # optional; use the same Redis as the API
npm run start --workspace @ngame/server
```

Frontend:

```bash
export VITE_API_URL=http://localhost:8000
export VITE_REALTIME_URL=http://localhost:2567
npm run dev --workspace @ngame/client
```

Open `http://localhost:5173`. Sign in with Google for a persistent profile or use Guest for one match. Separate tabs can use separate Guest identities because credentials are stored in per-tab `sessionStorage`.

## Verify

```bash
npm run typecheck
npm test
npm run build --workspace @ngame/client
npm run test:mobile --workspace @ngame/client
.venv/bin/python -m pytest backend/tests
npm run smoke:local --workspace @ngame/server
npm run soak:bots --workspace @ngame/server -- 100
```

The smoke test uses short-lived locally signed JWTs; Google callback/session behavior is covered by the backend tests.
