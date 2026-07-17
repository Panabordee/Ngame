# Ubuntu 24.04 + Docker

## 1. ติดตั้ง runtime

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2 openssl
sudo usermod -aG docker "$USER"
newgrp docker
```

## 2. ตั้ง Google OAuth

สร้าง OAuth client ชนิด **Web application** ใน Google แล้วเพิ่ม:

- Local origin: `http://localhost:8080`
- Local callback: `http://localhost:8000/auth/google/callback`
- Production origin: `https://ngame.ce-nacl.com`
- Production callback: `https://ngame-api.ce-nacl.com/auth/google/callback`

## 3. ตั้งค่า NGAME

```bash
cp .env.example .env
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
openssl rand -hex 32
```

ใส่ Google client ID/secret และค่าสุ่มที่ได้ลง `.env` ถ้ารัน Docker ในเครื่องให้คง URL แบบ localhost, `NGAME_ENV=development` และ `COOKIE_SECURE=false`

Production ใช้ค่าหลักดังนี้:

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
```

ถ้า Nginx อยู่คนละเครื่อง ให้ตั้ง `PUBLISH_ADDRESS` เป็น private IP ของ NGAME VM และ `FORWARDED_ALLOW_IPS` เป็น private IP ของ proxy พร้อมเปิดพอร์ต 8080, 8000 และ 2567 ให้เฉพาะ proxy เท่านั้น

## 4. Build และรัน

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api realtime frontend
```

เปิด `http://localhost:8080` และตรวจ health:

```bash
curl -f http://localhost:8000/healthz
curl -f http://localhost:2567/healthz
```

API รัน `alembic upgrade head` ทุกครั้งก่อนเริ่ม Migration `20260717_0002` จะลบบัญชี password เก่าและ refresh session ของบัญชีเหล่านั้นแบบถาวร

## 5. Proxy production และอัปเดต

ใช้ `infra/nginx/ngame.conf.example` กับ `ngame.ce-nacl.com`, `ngame-api.ce-nacl.com` และ `ngame-realtime.ce-nacl.com` เปลี่ยน `NGAME_VM_PRIVATE_IP` และตั้ง TLS ที่ proxy เดิม

```bash
git pull --ff-only
docker compose up -d --build --remove-orphans
docker compose ps
```

หยุดระบบโดยไม่ลบข้อมูลด้วย `docker compose down` ห้ามใช้ `docker compose down --volumes` เว้นแต่ตั้งใจลบ PostgreSQL และ Redis จริง ๆ
