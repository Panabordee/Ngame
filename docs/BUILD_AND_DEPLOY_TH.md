# การ Build, Docker Compose และ Deploy

## เตรียม Ubuntu 24.04 LTS

สร้าง Ubuntu Server 24.04 LTS VM บน Proxmox และกำหนด private address ให้คงที่ ค่าเริ่มต้นที่เหมาะสมคือ 4 vCPU, RAM 8 GB และ disk 50 GB แล้วปรับตามการวัดจริง ติดตั้ง Docker Engine, Buildx และ Docker Compose plugin จาก repository ทางการของ Docker สำหรับ Ubuntu

## เตรียม configuration และ secret

```bash
cp .env.example .env
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
```

เปลี่ยน password และ token placeholder ทุกค่า สำหรับ Compose บนเครื่องให้ใช้ URL localhost, `COOKIE_SECURE=false` และค่า email auth สำหรับ development

สำหรับ production ให้ตั้งค่า:

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

ตั้ง `GOOGLE_AUTH_ENABLED=true` หลังใส่ client ID/secret จริงและลงทะเบียน origin/callback ใน Google แล้วเท่านั้น ให้คง `EMAIL_VERIFICATION_REQUIRED=true` แม้ปิด email auth เพื่อป้องกันการเปิดรับสมัครแบบไม่ยืนยันอีเมลโดยไม่ตั้งใจ

## ตรวจ source ก่อน build

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

## Build และรัน Compose

```bash
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 api realtime frontend
```

API จะรัน `alembic upgrade head` ก่อนเปิด Uvicorn หากต้องการรัน migration เอง:

```bash
docker compose run --rm api alembic upgrade head
```

URL ของ Compose บนเครื่อง:

- Frontend: `http://localhost:8080`
- API health: `http://localhost:8000/healthz`
- Realtime health: `http://localhost:2567/healthz`

เปิด Mailpit เฉพาะ development:

```bash
docker compose --profile dev-mail up -d mailpit
```

Inbox อยู่ที่ `http://localhost:8025` หยุดระบบด้วย `docker compose down` ห้ามเพิ่ม `--volumes` เว้นแต่ตั้งใจลบข้อมูล PostgreSQL และ Redis

## Nginx ภายนอกและ firewall

ใช้ `infra/nginx/ngame.conf.example` เปลี่ยน `NGAME_VM_PRIVATE_IP` ตั้ง certificate ทั้งสาม hostname และคง WebSocket upgrade header สำหรับ realtime

ถ้า Nginx อยู่ VM เดียวกันให้ใช้ `PUBLISH_ADDRESS=127.0.0.1` ถ้าอยู่คนละเครื่องให้ใช้ private address ของ NGAME VM และอนุญาตพอร์ต 8080, 8000 และ 2567 จาก IP ของ proxy เท่านั้น ห้าม publish PostgreSQL หรือ Redis

ชี้ DNS ของ `ngame.ce-nacl.com`, `api.ngame.ce-nacl.com` และ `realtime.ngame.ce-nacl.com` ไปยัง proxy เดิม Certificate `*.ce-nacl.com` ไม่ครอบคลุม `api.ngame.ce-nacl.com` จึงต้องออก exact-name certificate หรือเพิ่ม `*.ngame.ce-nacl.com`

## ขั้นตอน update

ทำงานบน feature branch ตรวจ diff แล้วจึงรัน:

```bash
git pull --ff-only
docker compose build --pull
docker compose run --rm api alembic upgrade head
docker compose up -d --remove-orphans
docker compose ps
```

ตรวจ migration และ backup PostgreSQL ก่อนเปลี่ยน schema ห้ามแทนที่ database volume ระหว่าง update ปกติ

## Backup และ restore

ตั้ง schedule สำหรับ PostgreSQL logical dump ไปยัง storage นอก VM และเก็บ Proxmox VM backup แยกกัน ก่อนเปิดใช้งานจริงต้องบันทึกปลายทาง backup, encryption, retention, คำสั่ง restore และรอบทดสอบ restore การมี VM snapshot อย่างเดียวไม่เพียงพอสำหรับ database backup
