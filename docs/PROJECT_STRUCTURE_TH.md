# โครงสร้างโปรเจกต์

| Path | หน้าที่ |
| --- | --- |
| `client/` | React/Vite client, auth, action ในห้อง และ UI ไพ่ |
| `server/` | Colyseus matchmaking, ตรวจ JWT, authoritative room และ reconnect/forfeit |
| `shared/` | Pure game engine, type/protocol ร่วม, privacy projection, serialization และ engine test |
| `backend/` | FastAPI authentication, SQLAlchemy model, Alembic migration และ backend test |
| `docs/` | กติกา protocol operation architecture และข้อจำกัดทั้งภาษาอังกฤษ/ไทย |
| `infra/nginx/` | ตัวอย่าง Nginx reverse proxy สำหรับสาม public hostname |
| `docker-compose.yml` | Frontend, API, realtime, PostgreSQL และ Redis |
| `.env.example` | template configuration ที่มี placeholder เท่านั้น |
| `secrets/` | JWT key บนเครื่อง ถูก Git ignore และ mount เป็น Docker secret |
| `GAME_DESIGN.md` | เอกสารออกแบบภาษาอังกฤษฉบับหลัก |
| `GAME_DESIGN_TH.md` | เอกสารออกแบบฉบับภาษาไทย |
| `AGENTS.md` | กฎการทำงานและความปลอดภัยของ repository |

## Source file สำคัญ

- `shared/src/deck.ts`: สร้างสำรับปกติ จำนวน Joker และ helper สำหรับ shuffle
- `shared/src/rack.ts`: เปรียบเทียบหน้า/สีและตรวจ insertion โดยยอมให้ Joker วางอิสระ
- `shared/src/game.ts`: แจกไพ่ phase ของเทิร์น การเดา penalty การแพ้ ผู้ชนะ และ forfeit
- `shared/src/view.ts`: กรอง state ตามผู้เล่นเพื่อรักษาความลับ
- `shared/src/snapshot.ts`: serialize authoritative state สำหรับ reconnect/persistence boundary
- `shared/src/protocol.ts`: contract ของ message และ state envelope ที่ browser/server ใช้ร่วมกัน
- `server/src/CipherDeckRoom.ts`: lifecycle ของ authenticated room และ adapter ระหว่าง network กับ engine
- `server/src/auth.ts`: ตรวจ access token แบบ RS256
- `server/src/guestSessions.ts`: registry จอง/commit Guest หนึ่งเกมสำหรับ realtime instance เดียว
- `backend/src/ngame_api/routers/auth.py`: endpoint authentication สำหรับ browser
- `backend/src/ngame_api/services.py`: Google identity, access token และ refresh session
- `client/src/App.tsx`: lobby, ระบบเลขห้อง และ control สำหรับเล่นเกม

เก็บ rule transition ทั้งหมดไว้ใน `shared` เท่านั้น Networking และ UI เรียก transition ได้แต่ห้ามตัดสินผลเกมซ้ำเอง
