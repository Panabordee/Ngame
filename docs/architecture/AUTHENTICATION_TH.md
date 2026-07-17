# Authentication แบบ Google เท่านั้น

FastAPI เป็นผู้ดูแล authentication ส่วน NGAME จะไม่ได้รับ password ของ Google

## Browser flow

1. Client เปิด `GET /auth/google/start`
2. FastAPI เริ่ม Google OpenID Connect ด้วย scope `openid email profile` และ state cookie ที่ลงนาม
3. Google ส่งกลับมาที่ `GET /auth/google/callback`
4. FastAPI ตรวจ provider response และรับเฉพาะอีเมลที่ยืนยันแล้ว
5. FastAPI เก็บ Google `sub`, profile และ refresh-session token แบบ hash
6. Browser ได้ opaque refresh token ใน host-only cookie แบบ `HttpOnly`, `SameSite=Lax` และใช้ `Secure` บน production
7. `POST /auth/refresh` หมุน cookie แล้วออก access JWT แบบ RS256 อายุสั้น
8. Browser ส่ง access JWT ให้ Colyseus ซึ่งตรวจ issuer, audience, type, signature และ expiry

## Endpoint

| Method | Path | หน้าที่ |
| --- | --- | --- |
| `GET` | `/auth/google/start` | เริ่ม Google OAuth |
| `GET` | `/auth/google/callback` | ตรวจ Google และสร้าง session |
| `POST` | `/auth/refresh` | หมุน refresh session และออก access JWT |
| `POST` | `/auth/logout` | revoke session ปัจจุบันและล้าง cookie |
| `GET` | `/auth/me` | อ่าน profile ที่ยืนยันตัวตนแล้ว |

ไม่มี endpoint สมัครหรือล็อกอินด้วย password

## ข้อมูลที่เก็บ

- `users`: display name และสถานะบัญชี
- `auth_identities`: Google subject และ normalized verified email ที่ไม่ซ้ำ พร้อม provider
- `refresh_sessions`: hash ของ opaque token, expiry, revocation, rotation link และข้อมูล client

Migration `20260717_0002` ลบ password user เดิมพร้อม refresh session แล้ว drop ตาราง `password_credentials` การ downgrade สร้างตารางเปล่ากลับมาได้แต่กู้บัญชีที่ลบไม่ได้

## ข้อกำหนดความปลอดภัย

- ใช้ CORS origin แบบ exact ห้ามใช้ `*` ร่วมกับ credentials
- ห้ามเก็บ Google secret, OAuth state secret, refresh token และ JWT private key ใน log หรือ Git
- Mount JWT private key ให้ API container เท่านั้น
- ใช้ access JWT อายุสั้นและตั้ง refresh cookie เป็น `Secure` บน production
- เพิ่ม distributed rate limit ให้ OAuth, refresh และ matchmaking ก่อนเปิดสาธารณะ
