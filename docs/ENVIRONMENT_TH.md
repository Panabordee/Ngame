# การตั้งค่า Environment

คัดลอก `.env.example` เป็น `.env` สำหรับ Docker Compose ห้าม commit `.env` หรือโฟลเดอร์ `secrets/`

## URL และ network exposure

| ตัวแปร | ค่า Local Compose | ค่า production/หน้าที่ |
| --- | --- | --- |
| `FRONTEND_PUBLIC_URL` | `http://localhost:8080` | `https://ngame.ce-nacl.com` |
| `API_PUBLIC_URL` | `http://localhost:8000` | `https://ngame-api.ce-nacl.com` |
| `REALTIME_PUBLIC_URL` | `http://localhost:2567` | `https://ngame-realtime.ce-nacl.com` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | origin ของ frontend แบบ exact; คั่นหลายค่าด้วย comma |
| `VITE_API_URL` | `http://localhost:8000` | API URL ตอน build Vite โดยตรง |
| `VITE_REALTIME_URL` | `http://localhost:2567` | realtime URL ตอน build Vite โดยตรง |
| `PUBLISH_ADDRESS` | `127.0.0.1` | address ที่ bind พอร์ต Compose สาธารณะ |
| `FRONTEND_PORT` | `8080` | frontend host port |
| `API_PORT` | `8000` | API host port |
| `REALTIME_PORT` | `2567` | realtime host port |
| `REALTIME_HOST` | `0.0.0.0` | address ที่ realtime ฟังใน container |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | IP ของ Nginx ที่เชื่อถือ forwarded header |

## Database และ Redis

| ตัวแปร | หน้าที่ |
| --- | --- |
| `POSTGRES_DB` | ชื่อฐานข้อมูล PostgreSQL |
| `POSTGRES_USER` | role ของ PostgreSQL |
| `POSTGRES_PASSWORD` | password แบบสุ่มยาวและไม่ซ้ำ |
| `DATABASE_URL` | SQLAlchemy async URL; Compose เปลี่ยน host เป็น `postgres` |
| `REDIS_URL` | เตรียมไว้สำหรับ matchmaking/rate limit/snapshot |

PostgreSQL และ Redis อยู่ใน Compose network แบบ internal และไม่มีพอร์ต publish

## Access token และ refresh token

| ตัวแปร | หน้าที่ |
| --- | --- |
| `JWT_PRIVATE_KEY_FILE` | private PEM สำหรับ FastAPI เท่านั้น |
| `JWT_PUBLIC_KEY_FILE` | public PEM สำหรับ FastAPI และ Colyseus |
| `JWT_ISSUER` | ค่า `iss` ที่ต้องตรงกัน; production ใช้ API URL |
| `JWT_AUDIENCE` | ค่า `aud` ปัจจุบันคือ `ngame` |
| `ACCESS_TOKEN_TTL_SECONDS` | อายุ access token ค่าเริ่มต้น 900 วินาที |
| `REFRESH_TOKEN_TTL_DAYS` | อายุ refresh session ค่าเริ่มต้น 30 วัน |
| `REFRESH_COOKIE_NAME` | ชื่อ host-only HttpOnly refresh cookie |
| `COOKIE_SECURE` | production HTTPS ต้องเป็น `true` |

สร้าง RSA key pair แยกทุก environment และห้าม mount private key เข้า realtime หรือ frontend container

## ผู้ให้บริการ Authentication

| ตัวแปร | หน้าที่ |
| --- | --- |
| `OAUTH_STATE_SECRET` | secret แบบสุ่มสำหรับลงนาม OAuth state/session |
| `GOOGLE_AUTH_ENABLED` | เปิด Google endpoint หลังตั้ง credential |
| `GOOGLE_CLIENT_ID` | Google OIDC client ID |
| `GOOGLE_CLIENT_SECRET` | Google OIDC client secret |
| `GOOGLE_REDIRECT_URI` | FastAPI callback URI ที่ต้องตรงทุกตัวอักษร |
| `EMAIL_AUTH_ENABLED` | เปิดสมัคร/login ด้วย password สำหรับ local |
| `EMAIL_VERIFICATION_REQUIRED` | ต้องเป็น true เมื่อเปิด production email auth |
| `SMTP_*` | เตรียมไว้สำหรับ SMTP; ค่า Mailpit ใช้ development เท่านั้น |

API ปัจจุบันยังไม่ส่งอีเมลยืนยันหรือ reset password จึงต้องปิด production email auth ไว้

## พฤติกรรม Realtime

| ตัวแปร | หน้าที่ |
| --- | --- |
| `RECONNECT_TIMEOUT_SECONDS` | เวลาหยุดทั้งห้องเพื่อรอ reconnect ค่าเริ่มต้น 30 |
| `MAX_ROOM_MESSAGES_PER_SECOND` | จำกัดข้อความ Colyseus ต่อ client ค่าเริ่มต้น 20 |
| `REALTIME_INTERNAL_TOKEN` | เตรียมไว้สำหรับ match-result API ในอนาคต |

`NGAME_ENV=production` เปิด validation ที่เข้มขึ้น ส่วน `LOG_LEVEL` เตรียมไว้สำหรับ deployment โดย structured logging ยังเป็นงานในอนาคต
