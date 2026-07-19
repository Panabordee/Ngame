# Local development

## ตั้งค่าครั้งแรก

ต้องมี Node.js 24.18+, Python 3.12+ และ OpenSSL ส่วน Redis ไม่จำเป็นสำหรับ local แบบ process เดียว แต่แนะนำเมื่อทดสอบพฤติกรรมแบบ production/multi-instance

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

### สิ่งที่ต่างจากวิธีรันเดิม

- หลัง pull ต้องรัน `alembic upgrade head` อีกครั้ง เพราะ migration ใหม่เพิ่ม match/social และระบบจัดการ deck theme
- วิธีเปิดสาม terminal เดิมยังใช้ได้ โดย rate limit, Guest binding, การจองห้องต่อบัญชี และเลขห้องจะเก็บใน memory ของ process
- ถ้าต้องการทดสอบเหมือน production ให้เปิด Redis แล้วกำหนด `REDIS_URL` เดียวกันใน API และ realtime เพื่อให้การจองและ rate limit เป็น atomic ข้าม process
- กำหนด `ADMIN_EMAILS` เป็นอีเมล Google ที่ยืนยันแล้วคั่นด้วย comma เฉพาะกรณีต้องใช้ deck admin
- วิธีเปิด frontend ไม่เปลี่ยน แต่บนมือถือออกแบบให้เล่นแนวนอน

เปิด Redis เพิ่มได้ด้วย:

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
export REDIS_URL=redis://127.0.0.1:6379 # ไม่บังคับ
export API_RATE_LIMIT_PER_MINUTE=120
export ADMIN_EMAILS='your-admin-google-email@example.com' # ไม่บังคับ
uvicorn ngame_api.main:app --app-dir backend/src --host 127.0.0.1 --port 8000
```

Realtime:

```bash
export JWT_PUBLIC_KEY_FILE=../secrets/jwt-public.pem
export JWT_ISSUER=http://localhost:8000
export JWT_AUDIENCE=ngame
export CORS_ALLOWED_ORIGINS=http://localhost:5173
export REDIS_URL=redis://127.0.0.1:6379 # ไม่บังคับ และควรใช้ตัวเดียวกับ API
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
npm run test:mobile --workspace @ngame/client
.venv/bin/python -m pytest backend/tests
npm run smoke:local --workspace @ngame/server
npm run soak:bots --workspace @ngame/server -- 100
```

Smoke test ใช้ JWT อายุสั้นที่ลงนามจาก key local ส่วน Google callback/session ถูกทดสอบใน backend tests
