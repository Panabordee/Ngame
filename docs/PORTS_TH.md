# พอร์ตและ Hostname

## พอร์ตสำหรับ Local และ Compose

| Service | พัฒนาโดยตรง | พอร์ตบน Docker host | พอร์ตใน container | Production hostname |
| --- | ---: | ---: | ---: | --- |
| Vite frontend | `5173` | `8080` | `8080` | `ngame.ce-nacl.com` |
| Vite preview | `4173` | — | — | — |
| FastAPI | `8000` | `8000` | `8000` | `api.ngame.ce-nacl.com` |
| Colyseus realtime | `2567` | `2567` | `2567` | `realtime.ngame.ce-nacl.com` |
| PostgreSQL | — | ไม่ publish | `5432` | ไม่มี |
| Redis | — | ไม่ publish | `6379` | ไม่มี |
| Mailpit web UI | — | `8025` เฉพาะ optional profile | `8025` | ไม่มี |
| Mailpit SMTP | — | ไม่ publish | `1025` | ไม่มี |

`PUBLISH_ADDRESS` ควบคุม address ที่ bind พอร์ต 8080, 8000 และ 2567 ใช้ `127.0.0.1` เมื่อ Nginx อยู่ VM เดียวกัน ถ้า Nginx อยู่เครื่องอื่น ให้ bind private address ของ NGAME VM และตั้ง firewall ให้ proxy เข้าถึงได้เพียงเครื่องเดียว

พอร์ตที่เปิดสู่ internet ควรมีเพียง 80 และ 443 บน reverse proxy ห้ามเปิด PostgreSQL, Redis หรือ Mailpit สู่ internet
