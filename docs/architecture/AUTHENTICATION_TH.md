# Authentication แบบ Google และ Guest หนึ่งเกม

FastAPI เป็นผู้ดูแล authentication ส่วน NGAME จะไม่ได้รับ password ของ Google

## Browser flow

1. Client เปิด `GET /auth/google/start`
2. FastAPI เริ่ม Google OpenID Connect ด้วย scope `openid email profile` และ state cookie ที่ลงนาม
3. Google ส่งกลับมาที่ `GET /auth/google/callback`
4. FastAPI ตรวจ provider response และรับเฉพาะอีเมลที่ยืนยันแล้ว
5. FastAPI เก็บ Google `sub`, profile และ refresh-session token แบบ hash
6. Browser ได้ opaque refresh token ใน host-only cookie แบบ `HttpOnly`, `SameSite=Lax` และใช้ `Secure` บน production
7. `POST /auth/refresh` หมุน cookie แล้วออก access JWT แบบ RS256 อายุสั้น
8. Browser ส่ง access JWT ให้ Colyseus ซึ่งตรวจ issuer, audience, type, signature, expiry และ claim `name` ที่ server ออกให้

## Flow ของ Guest

1. Client ส่ง display name ที่จะเว้นว่างก็ได้ไปยัง `POST /auth/guest`
2. FastAPI ออก RS256 access JWT ที่มี `account_type=guest`, `sub` แบบสุ่ม และ `guest_session_id` แยกต่างหาก
3. ระบบไม่สร้าง user, identity หรือ refresh-session ในฐานข้อมูล response ใช้ `no-store` และไม่ตั้ง cookie
4. Browser เก็บ Guest credential เฉพาะ `sessionStorage` ของแท็บนั้น ไม่เกิน `GUEST_SESSION_TTL_SECONDS`
5. Realtime จอง Guest session ให้ห้องแรก โดย Guest แก้ชื่อที่แสดงในห้องได้ระหว่างรอ Server จะตรวจชื่อ, broadcast พร้อม account type ที่มีป้าย Guest และล็อกชื่อเมื่อ Start ถ้าออกก่อน host เริ่มจะคืน reservation แต่เมื่อเริ่มเกมแล้ว session จะถูก commit และ JWT นั้นเข้าห้องเกมที่สองไม่ได้
6. Client เก็บ Colyseus reconnection token ในแท็บเดิม เพื่อให้ refresh หน้าแล้วกลับเกมเดิมได้ภายในช่วง reconnect
7. เมื่อเกมจบหรือ sign out จะลบ Guest credential โดย Guest แก้ profile หรือใช้ endpoint ฐานข้อมูลไม่ได้

## Endpoint

| Method | Path | หน้าที่ |
| --- | --- | --- |
| `GET` | `/auth/google/start` | เริ่ม Google OAuth |
| `GET` | `/auth/google/callback` | ตรวจ Google และสร้าง session |
| `POST` | `/auth/guest` | ออก Guest JWT ชั่วคราวสำหรับหนึ่งเกม |
| `POST` | `/auth/refresh` | หมุน refresh session และออก access JWT |
| `POST` | `/auth/logout` | revoke session ปัจจุบันและล้าง cookie |
| `GET` | `/auth/me` | อ่าน profile ที่ยืนยันตัวตนแล้ว |
| `PATCH` | `/auth/me` | แก้ display name และ username ที่ไม่ซ้ำ |

ไม่มี endpoint สมัครหรือล็อกอินด้วย password

## ข้อมูลที่เก็บ

- `users`: display name, username แบบ normalized ที่ไม่ซ้ำ, URL รูปจาก Google และสถานะบัญชี
- `auth_identities`: Google subject และ normalized verified email ที่ไม่ซ้ำ พร้อม provider
- `refresh_sessions`: hash ของ opaque token, expiry, revocation, rotation link และข้อมูล client

Guest ไม่สร้างข้อมูลในตารางเหล่านี้ identity และ expiry อยู่ใน JWT ที่ลงนาม ส่วนการผูกหนึ่งเกมเก็บแบบ atomic ใน Redis เมื่อเปิดใช้

Migration `20260717_0002` ลบ password user เดิมพร้อม refresh session แล้ว drop ตาราง `password_credentials` การ downgrade สร้างตารางเปล่ากลับมาได้แต่กู้บัญชีที่ลบไม่ได้

Migration `20260717_0004` เพิ่ม username ที่แก้ได้และรูป profile จาก Google โดย username ยาว 3–20 ตัว ใช้ตัวอักษรอังกฤษ ตัวเลข หรือ underscore และเก็บแบบ case-folded

## ข้อกำหนดความปลอดภัย

- ใช้ CORS origin แบบ exact ห้ามใช้ `*` ร่วมกับ credentials
- ห้ามเก็บ Google secret, OAuth state secret, refresh token และ JWT private key ใน log หรือ Git
- Mount JWT private key ให้ API container เท่านั้น
- ใช้ access JWT อายุสั้นและตั้ง refresh cookie เป็น `Secure` บน production
- Guest JWT ต้องมี `account_type=guest`, `guest_session_id` และ expiry โดย realtime ไม่เชื่อ player ID หรือ display name ที่ client ส่งเอง
- เมื่อรันหลาย replica ระบบใช้ Redis แบบ atomic กับ Guest binding, การจองห้องของบัญชีปกติ และเลขห้อง ส่วน local ใช้ in-memory implementation
- เพิ่ม distributed rate limit ให้ OAuth, refresh และ matchmaking ก่อนเปิดสาธารณะ
