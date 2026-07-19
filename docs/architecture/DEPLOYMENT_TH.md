# สถาปัตยกรรม Deploy ของ NGAME

## เป้าหมาย Production

- Hypervisor: Proxmox
- Guest: Ubuntu Server 24.04 LTS VM
- Runtime: Docker Engine พร้อม Docker Compose plugin
- TLS entry point: Nginx reverse proxy ที่ดูแลเองอยู่แล้ว
- Domain: `ce-nacl.com`

เลือก VM แทน nested Docker LXC เพื่อให้ kernel, network และ storage ทำงานแบบมาตรฐาน ควรวาง application VM และ proxy ใน trusted LAN เดียวกัน

## Public Hostname

| Hostname | Upstream service | พอร์ต VM เริ่มต้น |
| --- | --- | ---: |
| `ngame.ce-nacl.com` | React frontend | `8080` |
| `ngame-api.ce-nacl.com` | FastAPI | `8000` |
| `ngame-realtime.ce-nacl.com` | Colyseus WebSocket | `2567` |

สร้าง DNS record แยกสำหรับ `ngame`, `ngame-api` และ `ngame-realtime` หรือใช้ wildcard DNS record ที่เหมาะสม ทั้งสามชื่อเป็น subdomain ชั้นเดียวของ `ce-nacl.com` จึงใช้ wildcard certificate `*.ce-nacl.com` ครอบคลุมได้ทั้งหมด

Google OAuth redirect สำหรับ production คือ:

```text
https://ngame-api.ce-nacl.com/auth/google/callback
```

## Container

| Service | หน้าที่ | การเปิดสู่ภายนอก |
| --- | --- | --- |
| `frontend` | ให้บริการ React/Vite build | ผ่าน Nginx เท่านั้น |
| `api` | Authentication, profile, match history, social, leaderboard, puzzle และ deck metadata | ผ่าน Nginx เท่านั้น |
| `realtime` | Matchmaking และ authoritative CipherDeck room | ผ่าน Nginx เท่านั้น |
| `postgres` | Persistent relational data | ห้ามเปิดสาธารณะ |
| `redis` | Presence/discovery, rate limit, identity/room registry, recovery checkpoint และ result outbox | ห้ามเปิดสาธารณะ |

FastAPI ดูแล persistent application data ส่วน Colyseus ดูแล live match state และส่งผลผู้เล่นที่ลงทะเบียนผ่าน internal FastAPI endpoint ที่ยืนยันตัวตนแล้ว ทั้ง frontend และ Colyseus ห้ามเขียน PostgreSQL โดยตรง

## Network และ Firewall

ใช้ Compose network แยกกัน:

- `edge`: frontend, API และ realtime
- `data`: API, realtime, PostgreSQL และ Redis โดยตั้งเป็น internal

ถ้า Nginx อยู่ VM เดียวกัน publish application port บน `127.0.0.1` ถ้าอยู่คนละ host ให้ publish บน private LAN address และอนุญาตจาก proxy IP เท่านั้น ห้ามเปิด PostgreSQL 5432 หรือ Redis 6379 ออกนอก Compose

มีเพียง Nginx ที่ควรรับ public traffic พอร์ต 80/443 โดย terminate TLS และส่ง original host, client IP และ protocol header ส่วน realtime virtual host ต้องรองรับ WebSocket upgrade

## Data และ Recovery

เก็บ path เหล่านี้ใน named volume:

- PostgreSQL data
- Redis data เมื่อเปิด persistence

ทำ PostgreSQL logical dump ตาม schedule เพิ่มจาก Proxmox VM backup เพราะ VM snapshot อย่างเดียวไม่ใช่กลยุทธ์ database backup เกม reconnect กลับ live room เมื่อหลุดระยะสั้นและ checkpoint authoritative transition ใน Redis หนึ่งชั่วโมง แต่การสร้างห้องและพา client ทั้งหมดกลับอัตโนมัติหลัง realtime container/VM crash ยังต้องมี orchestrator
