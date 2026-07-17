# Local development

## ตั้งค่าครั้งแรก

ต้องมี Node.js 24.18+, Python 3.12+ และ OpenSSL

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

สร้าง Google OAuth client ชนิด **Web application** แล้วตั้ง:

- Authorized JavaScript origin: `http://localhost:5173`
- Redirect URI: `http://localhost:8000/auth/google/callback`

## เปิดสาม terminal

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
uvicorn ngame_api.main:app --app-dir backend/src --host 127.0.0.1 --port 8000
```

Realtime:

```bash
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export JWT_AUDIENCE=ngame
export CORS_ALLOWED_ORIGINS=http://localhost:5173
npm run start --workspace @ngame/server
```

Frontend:

```bash
export VITE_API_URL=http://localhost:8000
export VITE_REALTIME_URL=http://localhost:2567
npm run dev --workspace @ngame/client
```

เปิด `http://localhost:5173` ใช้ Google สำหรับ profile ถาวรหรือ Guest สำหรับหนึ่งเกม แต่ละแท็บสร้าง Guest แยกกันได้เพราะ credential เก็บใน `sessionStorage` ของแท็บ

## ตรวจระบบ

```bash
npm run typecheck
npm test
npm run build --workspace @ngame/client
.venv/bin/python -m pytest backend/tests
npm run smoke:local --workspace @ngame/server
```

Smoke test ใช้ JWT อายุสั้นที่ลงนามจาก key local ส่วน Google callback/session ถูกทดสอบใน backend tests
