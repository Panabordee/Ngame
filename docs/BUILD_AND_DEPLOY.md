# Ubuntu 24.04 + Docker

## 1. Install the runtime

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2 openssl
sudo usermod -aG docker "$USER"
newgrp docker
```

## 2. Configure Google OAuth

Create a Google **Web application** OAuth client and add:

- Local origin: `http://localhost:8080`
- Local callback: `http://localhost:8000/auth/google/callback`
- Production origin: `https://ngame.ce-nacl.com`
- Production callback: `https://ngame-api.ce-nacl.com/auth/google/callback`

## 3. Configure NGAME

```bash
cp .env.example .env
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
openssl rand -hex 32
```

Put the Google client ID/secret and the generated random value into `.env`. For local Docker keep the localhost URLs, `NGAME_ENV=development`, and `COOKIE_SECURE=false`.

For production use:

```dotenv
NGAME_ENV=production
FRONTEND_PUBLIC_URL=https://ngame.ce-nacl.com
API_PUBLIC_URL=https://ngame-api.ce-nacl.com
REALTIME_PUBLIC_URL=https://ngame-realtime.ce-nacl.com
CORS_ALLOWED_ORIGINS=https://ngame.ce-nacl.com
JWT_ISSUER=https://ngame-api.ce-nacl.com
GOOGLE_AUTH_ENABLED=true
GUEST_AUTH_ENABLED=true
GUEST_SESSION_TTL_SECONDS=21600
GOOGLE_REDIRECT_URI=https://ngame-api.ce-nacl.com/auth/google/callback
COOKIE_SECURE=true
ADMIN_EMAILS=admin@example.com
API_RATE_LIMIT_PER_MINUTE=120
```

If Nginx is on another host, also set `PUBLISH_ADDRESS` to the NGAME VM private IP and `FORWARDED_ALLOW_IPS` to the proxy private IP. Allow ports 8080, 8000, and 2567 only from that proxy.

## 4. Build and run

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api realtime frontend
```

Open `http://localhost:8080`. Health checks:

```bash
curl -f http://localhost:8000/healthz
curl -f http://localhost:2567/healthz
```

The API runs `alembic upgrade head` on every start. Current migrations add match history, social data, admin roles, deck metadata/assets, and audit logs. Migration `20260717_0002` permanently removes old password accounts and their refresh sessions.

Compared with the earlier deployment, Redis is now required by both API and realtime in Compose. It coordinates rate limits, active account/Guest room bindings, six-digit room-code allocation, room discovery, recovery checkpoints, and the match-result outbox. No extra published port is required.

## 5. Production proxy and updates

Use `infra/nginx/ngame.conf.example` for `ngame.ce-nacl.com`, `ngame-api.ce-nacl.com`, and `ngame-realtime.ce-nacl.com`. Replace `NGAME_VM_PRIVATE_IP` and configure TLS on the existing proxy.

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
```

Stop without deleting data using `docker compose down`. Never use `docker compose down --volumes` unless PostgreSQL and Redis data are intentionally being erased.
