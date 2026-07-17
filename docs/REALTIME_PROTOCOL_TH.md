# Realtime Room Protocol

ชื่อ Colyseus room คือ `cipher_deck` FastAPI เป็นผู้ออก credential ส่วน Colyseus รับเฉพาะ access JWT อายุสั้นที่ถูกต้อง และใช้ claim `sub` เป็น player ID

## การเข้าห้อง

กำหนด access token ก่อน matchmaking โดย Quick Match จะเข้าห้องสาธารณะที่กำหนดจำนวนผู้เล่นเท่ากันเท่านั้น:

```ts
const client = new Client("http://localhost:2567");
client.auth.token = accessToken;
const room = await client.joinOrCreate("cipher_deck", {
  desiredPlayers: 3,
  lobbyMode: "public",
});
```

`desiredPlayers` ต้องเป็นจำนวนเต็ม 3–6 ห้องที่ตั้งจำนวนต่างกันจะไม่ match กัน ห้องจะ lock เมื่อเต็มและปฏิเสธ identity ซ้ำหรือการเข้ากลางเกม

สร้างห้องเลขด้วย `client.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" })` เซิร์ฟเวอร์จะส่ง `roomCode` 6 หลักที่ไม่ซ้ำมาใน state ผู้เข้าร่วมเรียก `GET /rooms/by-code/{roomCode}` เพื่อรับ `roomId` แล้วเรียก `client.joinById(roomId)` ห้องแบบรหัสจะไม่ถูกเลือกโดย Quick Match

หลัง join ให้ผูก message handler ทันทีแล้วส่ง `sync` เพื่อป้องกันการพลาด state ที่ถูกส่งระหว่าง join handshake

## ข้อความจาก Client ไป Server

| Type | Payload | Phase ที่ใช้ได้ |
| --- | --- | --- |
| `sync` | ไม่มี | ทุก phase |
| `draw` | ไม่มี | `draw` |
| `insert` | `{ "rackIndex": 0 }` | `place` หรือ `penalty-place` |
| `guess` | โครงสร้างด้านล่าง | `guess` |
| `stop` | ไม่มี | `guess` หลังเดาถูกอย่างน้อยหนึ่งครั้งและมีไพ่จั่วค้างอยู่ |
| `self-penalty` | `{ "cardId": "own opaque card ID" }` | `self-penalty` |

เดาไพ่ปกติ:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "standard", "rank": "Q", "color": "red" }
}
```

เดา Joker:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "joker" }
}
```

Phase ที่ authoritative engine ใช้คือ `draw`, `guess`, `place`, `penalty-place`, `self-penalty` และ `game-over` เมื่อจั่วจะเข้า `guess` ทันที ถ้าเดาถูกขณะมีไพ่ค้าง `correctGuessesThisTurn` จะเพิ่มและใช้ `stop` เพื่อเข้า `place` ได้ ถ้าเดาผิดจะเข้า `penalty-place` พร้อมเปิดไพ่จั่ว ส่วนเมื่อกองหมด เดาถูกจะเปลี่ยนเทิร์นทันทีและเดาผิดจะเข้า `self-penalty`

Server หา actor จาก connection ที่ยืนยันตัวตนแล้ว ไม่มี payload ใดกำหนดหรือเปลี่ยน `actorId` ได้

## ข้อความจาก Server ไป Client

`state` มีรูปแบบ:

```json
{
  "status": "waiting | playing | paused | finished",
  "desiredPlayers": 3,
  "lobbyMode": "public | code",
  "roomCode": "123456 หรือ null",
  "connectedPlayers": 3,
  "droppedPlayerIds": [],
  "game": "viewer-safe game object or null"
}
```

`game` มี rack ของผู้เล่น จำนวนไพ่ในกองจั่ว current player ID, phase, pending draw ของผู้ชมเมื่อมี, drawn-card ID, `correctGuessesThisTurn`, winner และเลขเทิร์น ถ้า pending card กลายเป็นโทษจากการเดาผิด ทุกคนจะเห็นไพ่ใบนั้นก่อนวาง ไพ่คู่แข่งที่ยังไม่เปิดมีเพียง `{ id, kind: "hidden", revealed: false }`

`error` มี `{ "code": "...", "message": "..." }` code ที่คาดได้เช่น `INVALID_MESSAGE`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION` และ `INVALID_TARGET`

ข้อความในห้องถูกจำกัดด้วย `MAX_ROOM_MESSAGES_PER_SECOND` ผลเกมจาก client จะถูกเพิกเฉย มีเพียง authoritative room ที่ตัดสินการเปิดไพ่ การแพ้ และผู้ชนะ
