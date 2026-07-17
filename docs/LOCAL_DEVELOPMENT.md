# Local development without Docker

## Prerequisites

- Node.js 24.18 or newer with npm
- Python 3.12 or newer
- OpenSSL

From the repository root:

```bash
npm ci
python -m venv .venv
source .venv/bin/activate
python -m pip install -e 'backend[dev]'
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
```

## Create the local SQLite schema

```bash
export DATABASE_URL=sqlite+aiosqlite:///../ngame.db
export JWT_PRIVATE_KEY_FILE=../secrets/jwt-private.pem
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
cd backend
alembic upgrade head
cd ..
```

## Start the three application processes

Use three terminals from the repository root.

Terminal 1 — FastAPI:

```bash
source .venv/bin/activate
export DATABASE_URL=sqlite+aiosqlite:///./ngame.db
export JWT_PRIVATE_KEY_FILE=secrets/jwt-private.pem
export JWT_PUBLIC_KEY_FILE=secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export FRONTEND_PUBLIC_URL=http://localhost:5173
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export COOKIE_SECURE=false
export EMAIL_AUTH_ENABLED=true
export EMAIL_VERIFICATION_REQUIRED=false
uvicorn ngame_api.main:app --app-dir backend/src --host 127.0.0.1 --port 8000
```

Terminal 2 — Colyseus:

```bash
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export JWT_AUDIENCE=ngame
npm run start --workspace @ngame/server
```

Terminal 3 — Vite:

```bash
export VITE_API_URL=http://localhost:8000
export VITE_REALTIME_URL=http://localhost:2567
npm run dev --workspace @ngame/client
```

Open `http://localhost:5173`. Register three different accounts in separate browser profiles or private sessions, choose the same player count, and join. The room starts when full.

## Verification commands

```bash
npm run typecheck
npm test
npm run build --workspace @ngame/client
source .venv/bin/activate
python -m pytest backend/tests
```

Health endpoints are `http://localhost:8000/healthz` and `http://localhost:2567/healthz`.

With API and realtime running, an automated smoke test creates three temporary accounts, fills a room, verifies viewer privacy, and draws the first card:

```bash
npm run smoke:local --workspace @ngame/server
```
