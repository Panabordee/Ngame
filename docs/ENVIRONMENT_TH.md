# Environment settings

คัดลอก `.env.example` เป็น `.env` และห้าม commit `.env` หรือ `secrets/`

## ค่าหลักของระบบ

| Variable | Local Docker | Production |
| --- | --- | --- |
| `NGAME_ENV` | `development` | `production` |
| `FRONTEND_PUBLIC_URL` | `http://localhost:8080` | `https://ngame.ce-nacl.com` |
| `API_PUBLIC_URL` | `http://localhost:8000` | `https://ngame-api.ce-nacl.com` |
| `REALTIME_PUBLIC_URL` | `http://localhost:2567` | `https://ngame-realtime.ce-nacl.com` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | origin ของ frontend แบบ exact |
| `PUBLISH_ADDRESS` | `127.0.0.1` | loopback หรือ private IP ของ VM |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | private IP ของ Nginx ที่เชื่อถือ |

Compose publish frontend `8080`, API `8000` และ realtime `2567` ส่วน PostgreSQL กับ Redis อยู่ใน network ภายใน

## Authentication

| Variable | หน้าที่ |
| --- | --- |
| `GOOGLE_AUTH_ENABLED` | ต้องเป็น `true`; production จะไม่เริ่มถ้าปิด |
| `GOOGLE_CLIENT_ID` | Google Web application client ID จริง |
| `GOOGLE_CLIENT_SECRET` | Google client secret จริง |
| `GOOGLE_REDIRECT_URI` | callback ของ FastAPI ที่ลงทะเบียนใน Google แบบตรงทุกตัวอักษร |
| `OAUTH_STATE_SECRET` | ค่าสุ่มเฉพาะอย่างน้อย 32 ตัวอักษร |
| `COOKIE_SECURE` | `false` บน localhost และ `true` บน production |
| `REFRESH_TOKEN_TTL_DAYS` | อายุ refresh session |
| `GUEST_AUTH_ENABLED` | เปิด Guest ชั่วคราวหนึ่งเกม ค่าเริ่มต้น `true` |
| `GUEST_SESSION_TTL_SECONDS` | อายุ Guest JWT ค่าเริ่มต้น `21600` (6 ชั่วโมง) |
| `ADMIN_EMAILS` | อีเมล Google ที่ยืนยันแล้วและได้รับสิทธิ์ deck admin คั่นด้วย comma |

ไม่มี password signup/signin แล้ว Google user เป็นบัญชีถาวร ส่วน Guest ไม่สร้างข้อมูลในฐานข้อมูลและไม่มี refresh cookie Migration `20260717_0002` จะลบบัญชี password เก่าและ session ของบัญชีนั้น

## JWT และข้อมูล

| Variable | หน้าที่ |
| --- | --- |
| `JWT_ISSUER` | URL ของ API และต้องตรงกันทั้ง API/realtime |
| `JWT_AUDIENCE` | audience ร่วม ค่าเริ่มต้น `ngame` |
| `JWT_PRIVATE_KEY_FILE` | private key ที่ mount ให้ API เท่านั้น |
| `JWT_PUBLIC_KEY_FILE` | public key สำหรับ API และ realtime |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | credential ของ PostgreSQL |
| `DATABASE_URL` | Compose จะ override ให้ API container |
| `REDIS_URL` | Redis presence/driver, rate bucket ต่อ user, recovery checkpoint และ match-result outbox |
| `API_RATE_LIMIT_PER_MINUTE` | จำนวน API request สูงสุดต่อ IP ต่อนาที ค่าเริ่มต้น `120` |
| `RECONNECT_TIMEOUT_SECONDS` | เวลารอ reconnect ค่าเริ่มต้น `30` |
| `MAX_ROOM_MESSAGES_PER_SECOND` | rate limit ทั้งต่อ connection และต่อ user ผ่าน Redis ค่าเริ่มต้น `20` |

Realtime container จะได้รับเฉพาะ JWT, CORS และค่า room โดยไม่ได้รับ Google หรือ database secret
