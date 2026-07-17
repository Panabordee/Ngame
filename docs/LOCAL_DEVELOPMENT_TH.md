# การพัฒนาบนเครื่องโดยไม่ใช้ Docker

## สิ่งที่ต้องติดตั้ง

- Node.js 24.18 ขึ้นไปพร้อม npm
- Python 3.12 ขึ้นไป
- OpenSSL

รันจาก root ของ repository:

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

## สร้าง schema ใน SQLite

```bash
export DATABASE_URL=sqlite+aiosqlite:///../ngame.db
export JWT_PRIVATE_KEY_FILE=../secrets/jwt-private.pem
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
cd backend
alembic upgrade head
cd ..
```

## เปิด application ทั้งสาม process

เปิด terminal สามหน้าจาก root ของ repository

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

เปิด `http://localhost:5173` สมัครสามบัญชีด้วย browser profile หรือ private session แยกกัน เลือกจำนวนผู้เล่นเท่ากันและเข้าห้อง เกมจะเริ่มเมื่อครบคน

## คำสั่งตรวจระบบ

```bash
npm run typecheck
npm test
npm run build --workspace @ngame/client
source .venv/bin/activate
python -m pytest backend/tests
```

Health endpoint คือ `http://localhost:8000/healthz` และ `http://localhost:2567/healthz`

เมื่อ API และ realtime ทำงานแล้ว สามารถทดสอบอัตโนมัติด้วยผู้เล่นชั่วคราว 3 คน:

```bash
npm run smoke:local --workspace @ngame/server
```
