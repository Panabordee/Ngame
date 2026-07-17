# Build, Docker Compose, and deployment

## Prepare Ubuntu 24.04 LTS

Create an Ubuntu Server 24.04 LTS VM on Proxmox with a stable private address. A reasonable starting allocation is 4 vCPU, 8 GB RAM, and 50 GB disk; adjust after measuring. Install Docker Engine, Buildx, and the Docker Compose plugin from Docker's official Ubuntu repository.

## Prepare configuration and secrets

```bash
cp .env.example .env
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
```

Replace every placeholder password/token. For a local Compose run, keep the localhost public URLs, `COOKIE_SECURE=false`, and development email auth settings.

For production set:

```dotenv
NGAME_ENV=production
FRONTEND_PUBLIC_URL=https://ngame.ce-nacl.com
API_PUBLIC_URL=https://api.ngame.ce-nacl.com
REALTIME_PUBLIC_URL=https://realtime.ngame.ce-nacl.com
CORS_ALLOWED_ORIGINS=https://ngame.ce-nacl.com
GOOGLE_REDIRECT_URI=https://api.ngame.ce-nacl.com/auth/google/callback
COOKIE_SECURE=true
EMAIL_AUTH_ENABLED=false
EMAIL_VERIFICATION_REQUIRED=true
```

Set `GOOGLE_AUTH_ENABLED=true` only after adding the real client ID/secret and registering the exact Google origin and callback. `EMAIL_VERIFICATION_REQUIRED=true` is harmless while email auth is disabled and prevents accidentally enabling unverified production registration.

## Validate source before building

```bash
npm ci
npm run typecheck
npm test
npm run build --workspace @ngame/client
python -m venv .venv
source .venv/bin/activate
python -m pip install -e 'backend[dev]'
python -m pytest backend/tests
```

## Build and run Compose

```bash
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 api realtime frontend
```

The API service runs `alembic upgrade head` before starting Uvicorn. To run the migration explicitly:

```bash
docker compose run --rm api alembic upgrade head
```

Local Compose URLs:

- Frontend: `http://localhost:8080`
- API health: `http://localhost:8000/healthz`
- Realtime health: `http://localhost:2567/healthz`

Start Mailpit only for development:

```bash
docker compose --profile dev-mail up -d mailpit
```

Its local inbox is `http://localhost:8025`. Stop the stack with `docker compose down`. Do not add `--volumes` unless intentionally deleting the PostgreSQL and Redis data.

## External Nginx and firewall

Use `infra/nginx/ngame.conf.example`. Replace `NGAME_VM_PRIVATE_IP`, configure certificates for all three hostnames, and preserve WebSocket upgrade headers for realtime traffic.

If Nginx is on the same VM, keep `PUBLISH_ADDRESS=127.0.0.1`. If it is on another host, set `PUBLISH_ADDRESS` to the VM's private address and allow ports 8080, 8000, and 2567 only from the proxy IP. Never publish PostgreSQL or Redis.

Point DNS for `ngame.ce-nacl.com`, `api.ngame.ce-nacl.com`, and `realtime.ngame.ce-nacl.com` to the existing proxy. A `*.ce-nacl.com` certificate does not cover `api.ngame.ce-nacl.com`; issue exact-name certificates or include `*.ngame.ce-nacl.com`.

## Update procedure

Work on a feature branch, review the diff, and then:

```bash
git pull --ff-only
docker compose build --pull
docker compose run --rm api alembic upgrade head
docker compose up -d --remove-orphans
docker compose ps
```

Review migrations and take a PostgreSQL backup before schema changes. Do not replace the database volume during routine updates.

## Backup and restore

Schedule PostgreSQL logical dumps to storage outside the VM and keep separate Proxmox VM backups. Record the production backup destination, encryption, retention, restore command, and restore-test schedule before launch. VM snapshots alone are not a sufficient database backup.
