# Realtime Room Protocol

ชื่อ Colyseus room คือ `cipher_deck` FastAPI ออก access JWT อายุสั้น ส่วน Colyseus ใช้ claim `sub` เป็น player ID และใช้ `name` ที่ server ออกให้เป็นชื่อแสดงผล

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

`desiredPlayers` ต้องเป็นจำนวนเต็ม 3–6 ห้องที่ตั้งจำนวนต่างกันจะไม่ match กัน ห้องจะ lock เมื่อ host กดเริ่มและปฏิเสธ identity ซ้ำหรือการเข้ากลางเกม Quick Match ใช้ Classic ส่วน host ห้องรหัสตั้ง Custom ได้ก่อน ready

สร้างห้องเลขด้วย `client.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" })` เซิร์ฟเวอร์จะส่ง `roomCode` 6 หลักที่ไม่ซ้ำมาใน state ผู้เข้าร่วมเรียก `GET /rooms/by-code/{roomCode}` เพื่อรับ `roomId` แล้วเรียก `client.joinById(roomId)` ห้องแบบรหัสจะไม่ถูกเลือกโดย Quick Match

หลัง join ให้ผูก message handler ทันทีแล้วส่ง `sync` เพื่อป้องกันการพลาด state ที่ถูกส่งระหว่าง join handshake

## ข้อความจาก Client ไป Server

| Type | Payload | Phase ที่ใช้ได้ |
| --- | --- | --- |
| `sync` | ไม่มี | ทุก phase |
| `ready` | `true` หรือ `false` | lobby ที่ยังรอ |
| `update-settings` | `{ preset, turnSeconds, totalCards, drawRounds, jokerCount }` | lobby, host เท่านั้น |
| `start-game` | ไม่มี | lobby, host เท่านั้นและทุกคน ready |
| `select-starting-card` | `{ "cardId": "opaque option ID" }` | phase เลือกคนเริ่ม |
| `place-starting-joker` | `{ "rackIndex": 0 }` | `starter-place`, เจ้าของเท่านั้น |
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

Classic บังคับใช้สำรับเต็ม รอบจั่วสี่รอบ และ Joker สุ่ม ส่วน Custom ตรวจไพ่รวม 24–56, รอบจั่ว 1–8 และ Joker 2–4

Phase ที่ authoritative engine ใช้คือ `starter-place`, `draw`, `guess`, `place`, `penalty-place`, `self-penalty` และ `game-over` เมื่อจั่วจะเข้า `guess` ทันที ถ้าเดาถูกขณะมีไพ่ค้าง `correctGuessesThisTurn` จะเพิ่มและใช้ `stop` เพื่อเข้า `place` ได้ ถ้าเดาผิดจะเข้า `penalty-place` พร้อมเปิดไพ่จั่ว ส่วนเมื่อกองหมด เดาถูกจะเปลี่ยนเทิร์นทันทีและเดาผิดจะเข้า `self-penalty`

Server หา actor จาก connection ที่ยืนยันตัวตนแล้ว ไม่มี payload ใดกำหนดหรือเปลี่ยน `actorId` ได้

## ข้อความจาก Server ไป Client

`state` มีรูปแบบ:

```json
{
  "status": "waiting | starting | playing | paused | finished",
  "desiredPlayers": 3,
  "lobbyMode": "public | code",
  "roomCode": "123456 หรือ null",
  "settings": "RoomSettings ที่ตรวจแล้ว",
  "startingSelection": "setup state ที่ปลอดภัยหรือ null",
  "hostPlayerId": "user UUID",
  "connectedPlayers": 3,
  "players": "ชื่อ, host, ready และ connection status",
  "droppedPlayerIds": [],
  "serverTimeMs": 0,
  "turnDeadlineMs": "epoch milliseconds หรือ null",
  "game": "viewer-safe game object or null"
}
```

ระหว่างเลือก ไพ่ตัวเลือกยังซ่อนค่าจนผู้มีสิทธิ์เลือกครบและเปิดเฉพาะใบที่เลือก ไพ่ที่ resolve แล้วจะยังเปิดระหว่าง tie redraw ส่วน `game` มี rack ที่กรองตามผู้ชม จำนวนกองจั่ว current player, phase, starting-card IDs, รายชื่อผู้รอวาง Joker, pending draw, winner และเลขเทิร์น ไพ่คู่แข่งที่ยังไม่เปิดมีเพียง `{ id, kind: "hidden", revealed: false }`

`error` มี `{ "code": "...", "message": "..." }` code ที่คาดได้เช่น `INVALID_MESSAGE`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION` และ `INVALID_TARGET`

ข้อความในห้องถูกจำกัดด้วย `MAX_ROOM_MESSAGES_PER_SECOND` ผลเกมจาก client จะถูกเพิกเฉย มีเพียง authoritative room ที่ตัดสินการเปิดไพ่ การแพ้ และผู้ชนะ
