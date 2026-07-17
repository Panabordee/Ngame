# สถาปัตยกรรม Authentication

## วิธี Login ที่รองรับ

API ปัจจุบันรองรับ:

- สมัครและ sign in ด้วย email/password
- Sign in ด้วย Google OpenID Connect

การ link หลาย identity เข้าบัญชีเดียวเป็นงานในอนาคต API จะไม่รวม password และ Google identity ที่อีเมลเหมือนกันโดยอัตโนมัติ

ระหว่างที่ยังไม่มี SMTP ให้ใช้ Mailpit ใน development และปิด email/password registration บน production โดย Google sign-in เหมาะกับ production ระยะแรก

## ผู้รับผิดชอบ Service

FastAPI เป็น authentication authority เพียงตัวเดียว ดูแล user, credential, external identity และ refresh session ส่วน verification/password-reset token ยังไม่ได้ทำ Colyseus ไม่ออก credential แต่ตรวจ access JWT อายุสั้นที่ FastAPI ออกให้เท่านั้น

## Flow บน Browser

1. Browser sign in ผ่าน FastAPI
2. FastAPI ส่ง access JWT อายุสั้นใน response body
3. FastAPI ตั้ง opaque refresh token ใน host-only cookie แบบ `Secure`, `HttpOnly`, `SameSite=Lax` บน `api.ngame.ce-nacl.com`
4. Browser เก็บ access JWT ใน memory ไม่ใช้ local storage
5. Browser ใส่ access JWT ให้ Colyseus client ก่อน matchmaking
6. Colyseus ตรวจ signature, issuer, audience, expiry และ token type ก่อนรับเข้าห้อง
7. Colyseus ใช้ claim `sub` เป็น player identity และไม่ใช้ connection/session ID แทน user ID

เมื่อ refresh หน้า frontend จะขอ access JWT ใหม่ผ่าน refresh cookie Refresh token ถูก rotate ทุกครั้งและเก็บเฉพาะ hash ใน PostgreSQL

## Google Sign-in

ใช้ authorization-code OpenID Connect flow โดย FastAPI รับ callback ตรวจ `state`, issuer, audience, signature, expiry และ nonce และขอ scope เฉพาะ `openid email profile`

ค่าที่ต้องตั้งใน Google Console สำหรับ production:

```text
Authorized JavaScript origin:
https://ngame.ce-nacl.com

Authorized redirect URI:
https://api.ngame.ce-nacl.com/auth/google/callback
```

ระบุ Google login ด้วย provider subject (`sub`) ที่คงที่ ห้ามใช้ display name และห้ามผูกกับ password account ที่มี email เหมือนกันแบบเงียบ ๆ

## API Contract ปัจจุบัน

| Method | Path | หน้าที่ |
| --- | --- | --- |
| `POST` | `/auth/register` | สร้างบัญชี email/password |
| `POST` | `/auth/login` | ตรวจ email/password |
| `POST` | `/auth/refresh` | rotate refresh token และคืน access JWT |
| `POST` | `/auth/logout` | revoke refresh session และลบ cookie |
| `GET` | `/auth/google/start` | เริ่ม Google OIDC flow |
| `GET` | `/auth/google/callback` | จบ Google OIDC flow |
| `GET` | `/auth/me` | คืน profile ที่ยืนยันตัวตนแล้ว |

Endpoint ที่วางแผนไว้คือ `/auth/verify-email`, `/auth/forgot-password` และ `/auth/reset-password` ต้องปิด production email auth จนกว่า flow เหล่านี้และ SMTP พร้อม

## Database Entity ปัจจุบัน

- `users`: user ID, display name, status และ timestamp
- `auth_identities`: provider, provider subject และ normalized email
- `password_credentials`: user ID และ Argon2id hash
- `refresh_sessions`: token hash, user ID, expiry, rotation chain และ revocation metadata

Email verification, password reset, match และ match-player record ต้องเพิ่ม migration ภายหลัง

## Security Baseline

- Hash password ด้วย Argon2id
- ลงนาม access JWT แบบ asymmetric และ mount key เป็น Docker secret
- Room action มี rate limit แล้ว ต้องเพิ่ม distributed rate limit ให้ register/login/refresh/reset/matchmaking ก่อนเปิดสาธารณะ
- เปิด credentialed CORS เฉพาะ frontend origin ที่ตรงกัน
- ใช้ `Secure` cookie ใน production และห้าม log token, password, authorization code หรือ client secret
- เก็บ Google secret และ JWT private key นอก repository
