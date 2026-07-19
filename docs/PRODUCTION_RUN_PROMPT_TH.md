# วิธีขึ้น Production จริงและ Prompt สำหรับ AI

ใช้กับ Ubuntu Server 24.04 LTS, Docker Compose และ Nginx reverse proxy ภายนอก ระบบมี frontend, FastAPI, Colyseus realtime, PostgreSQL และ Redis

## ข้อมูลที่ต้องเตรียม

- Domain สำหรับ frontend, API และ realtime พร้อม DNS/TLS
- Google OAuth Web client และ production callback
- Secret แบบสุ่มสำหรับ PostgreSQL, OAuth state และ internal match-result endpoint
- RSA private/public key สำหรับ JWT
- อีเมล Google ผู้ดูแลใน `ADMIN_EMAILS` หากใช้ Deck Admin
- สิทธิ์ SSH, Docker และแก้ Nginx บน proxy

ห้ามส่ง secret จริงเข้า prompt หรือ commit ลง Git ให้ใส่ใน `.env` และ `secrets/` บน server เท่านั้น

## คำสั่งรันจริงครั้งแรก

```bash
git clone git@github.com:Panabordee/Ngame.git
cd Ngame
git switch main
git pull --ff-only origin main

cp .env.example .env
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
openssl rand -hex 32

# แก้ .env ด้วย editor และใส่ค่าจริง ห้าม commit ไฟล์นี้
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 api realtime frontend
curl -f http://127.0.0.1:8000/healthz
curl -f http://127.0.0.1:2567/healthz
```

ค่าหลักใน `.env` สำหรับ production:

```dotenv
NGAME_ENV=production
FRONTEND_PUBLIC_URL=https://GAME_DOMAIN
API_PUBLIC_URL=https://API_DOMAIN
REALTIME_PUBLIC_URL=https://REALTIME_DOMAIN
CORS_ALLOWED_ORIGINS=https://GAME_DOMAIN
JWT_ISSUER=https://API_DOMAIN
GOOGLE_AUTH_ENABLED=true
GOOGLE_REDIRECT_URI=https://API_DOMAIN/auth/google/callback
COOKIE_SECURE=true
ADMIN_EMAILS=ADMIN_GOOGLE_EMAIL
API_RATE_LIMIT_PER_MINUTE=120
```

ต้องแทน placeholder และ secret อื่นทั้งหมดใน `.env.example` ก่อนรัน Production API จะปฏิเสธค่า development/placeholder และรัน `alembic upgrade head` อัตโนมัติก่อนเริ่ม

เมื่อ health check ภายในผ่าน ให้นำ `infra/nginx/ngame.conf.example` ไปติดตั้งบน reverse proxy, แทน `NGAME_VM_PRIVATE_IP`, ออก TLS certificate และทดสอบ URL ภายนอกทั้งสาม domain

## คำสั่งอัปเดต Production

```bash
cd Ngame
git fetch origin
git switch main
git pull --ff-only origin main

# สำรอง PostgreSQL ก่อน deploy โดยใช้ค่าจริงจาก .env โดยไม่แสดง password
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "ngame-before-deploy-$(date +%Y%m%d-%H%M%S).sql"

docker compose config
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs --tail=100 api realtime frontend
curl -f http://127.0.0.1:8000/healthz
curl -f http://127.0.0.1:2567/healthz
```

ตรวจว่าไฟล์ backup มีขนาดมากกว่า 0 ก่อน deploy

## Prompt พร้อมใช้สำหรับ AI

```text
คุณเป็น release engineer ของ NGAME/CipherDeck ให้ deploy branch main ขึ้น production บน Ubuntu Server 24.04 ด้วย Docker Compose และ Nginx ภายนอก

เป้าหมาย:
- ใช้เฉพาะ origin/main ห้าม deploy branch future/* หรือ archive/*
- รักษาข้อมูล PostgreSQL/Redis เดิม
- รัน migration ผ่าน startup command ของ Compose
- ตรวจ frontend, API, realtime, Google login, Guest login, room code, solo with bots และ mobile landscape

ข้อบังคับ:
1. อ่าน AGENTS.md, README.md, docs/BUILD_AND_DEPLOY.md, docs/ENVIRONMENT.md และ infra/nginx/ngame.conf.example ก่อนทำงาน
2. ห้ามแสดง, commit หรือส่ง secret เข้า chat/log และห้ามสร้าง secret ค่าเดาง่าย
3. ห้ามใช้ docker compose down --volumes, git reset --hard, force-push หรือแก้ production database ด้วย SQL ad-hoc
4. เริ่มด้วย read-only checks: git status/branch/origin/main, disk, Docker/Compose, container และ health เดิม
5. สำรอง PostgreSQL ด้วย pg_dump และยืนยันว่าไฟล์มีขนาดมากกว่า 0 ก่อน migration
6. รัน docker compose config; หยุดถามเฉพาะเมื่อขาดค่าที่เดาไม่ได้ เช่น domain, Google credential, proxy IP, TLS หรือ SSH
7. ใช้ docker compose up -d --build --remove-orphans และรายงานสถานะอย่างน้อยทุก 60 วินาที
8. หากไม่ healthy ให้เก็บ logs, ระบุสาเหตุ และ rollback application ไป commit ก่อนหน้าโดยไม่ downgrade migration หรือทำลายข้อมูลอัตโนมัติ
9. หลัง deploy ตรวจ API/realtime /healthz, frontend HTTPS, CORS/WebSocket, Google callback และสร้างห้องทดสอบ ห้ามใช้บัญชีจริงทำ destructive test
10. สรุป commit, migration, container status, health URLs, backup path และปัญหาคงเหลือ โดยปิดบังค่า secret

ค่าที่ operator ให้แยกต่างหาก:
- GAME_DOMAIN=[ใส่ค่า]
- API_DOMAIN=[ใส่ค่า]
- REALTIME_DOMAIN=[ใส่ค่า]
- NGAME_VM_PRIVATE_IP=[ใส่ค่า]
- NGINX_PROXY_IP=[ใส่ค่า]
- ADMIN_EMAILS=[ใส่ค่า หรือเว้นว่าง]

หากข้อมูลครบ ให้ทำจน production healthy โดยไม่ถามยืนยันขั้นตอนปกติซ้ำ
```

## Rollback

หาก image ใหม่มีปัญหาแต่ฐานข้อมูลยังปกติ ให้ deploy application commit ก่อนหน้าและตรวจ health ห้าม downgrade migration อัตโนมัติ การย้อน migration ต้องพิจารณาจาก migration และ backup ที่ตรวจสอบแล้วเป็นรายกรณี
