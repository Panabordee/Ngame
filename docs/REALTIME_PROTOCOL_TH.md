# Realtime Room Protocol

ชื่อ Colyseus room คือ `cipher_deck` FastAPI เป็นผู้ออก credential ส่วน Colyseus รับเฉพาะ access JWT อายุสั้นที่ถูกต้อง และใช้ claim `sub` เป็น player ID

## การเข้าห้อง

กำหนด access token ก่อน matchmaking และส่งจำนวนผู้เล่นตายตัว:

```ts
const client = new Client("http://localhost:2567");
client.auth.token = accessToken;
const room = await client.joinOrCreate("cipher_deck", { desiredPlayers: 3 });
```

`desiredPlayers` ต้องเป็นจำนวนเต็ม 3–6 ห้องที่ตั้งจำนวนต่างกันจะไม่ match กัน ห้องจะ lock เมื่อเต็มและปฏิเสธ identity ซ้ำหรือการเข้ากลางเกม

หลัง join ให้ผูก message handler ทันทีแล้วส่ง `sync` เพื่อป้องกันการพลาด state ที่ถูกส่งระหว่าง join handshake

## ข้อความจาก Client ไป Server

| Type | Payload | Phase ที่ใช้ได้ |
| --- | --- | --- |
| `sync` | ไม่มี | ทุก phase |
| `draw` | ไม่มี | `draw` |
| `insert` | `{ "rackIndex": 0 }` | `insert` |
| `guess` | โครงสร้างด้านล่าง | `guess` |

เดาไพ่ปกติ:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "standard", "rank": "Q", "color": "red" },
  "selfRevealCardId": null
}
```

เดา Joker พร้อมเลือกไพ่ penalty เมื่อกองจั่วหมด:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "joker" },
  "selfRevealCardId": "own opaque card ID"
}
```

Server หา actor จาก connection ที่ยืนยันตัวตนแล้ว ไม่มี payload ใดกำหนดหรือเปลี่ยน `actorId` ได้

## ข้อความจาก Server ไป Client

`state` มีรูปแบบ:

```json
{
  "status": "waiting | playing | paused | finished",
  "desiredPlayers": 3,
  "connectedPlayers": 3,
  "droppedPlayerIds": [],
  "game": "viewer-safe game object or null"
}
```

`game` มี rack ของผู้เล่น จำนวนไพ่ในกองจั่ว current player ID, phase, pending draw ของผู้ชมเมื่อมี, drawn-card ID, winner และเลขเทิร์น ไพ่คู่แข่งที่ยังไม่เปิดมีเพียง `{ id, kind: "hidden", revealed: false }`

`error` มี `{ "code": "...", "message": "..." }` code ที่คาดได้เช่น `INVALID_MESSAGE`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION` และ `INVALID_TARGET`

ข้อความในห้องถูกจำกัดด้วย `MAX_ROOM_MESSAGES_PER_SECOND` ผลเกมจาก client จะถูกเพิกเฉย มีเพียง authoritative room ที่ตัดสินการเปิดไพ่ การแพ้ และผู้ชนะ
