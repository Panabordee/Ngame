# Realtime Room Protocol

ชื่อ Colyseus room คือ `cipher_deck` FastAPI ออก access JWT ที่ลงนาม ส่วน Colyseus ใช้ claim `sub` เป็น player ID และใช้ `name` ที่ server ออกให้เป็นชื่อแสดงผล JWT ของบัญชีใช้ `account_type=registered` ส่วน Guest ใช้ `account_type=guest` พร้อม `guest_session_id` ที่ server สร้าง

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

`desiredPlayers` ต้องเป็นจำนวนเต็ม 3–6 ห้องที่ตั้งจำนวนต่างกันจะไม่ match กัน หลังเริ่มเกม room ปฏิเสธ join แบบผู้เล่น แต่ `{ spectator: true }` เข้าชมห้องรหัสที่เริ่มแล้วได้ด้วย public-only projection Quick Match ใช้ Classic ส่วน host ห้องรหัสตั้ง Custom ได้ก่อน ready

สร้างห้องเลขด้วย `client.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" })` เซิร์ฟเวอร์จะส่ง `roomCode` 6 หลักที่ไม่ซ้ำมาใน state ผู้เข้าร่วมเรียก `GET /rooms/by-code/{roomCode}` เพื่อรับ `roomId` แล้วเรียก `client.joinById(roomId)` ห้องแบบรหัสจะไม่ถูกเลือกโดย Quick Match

หลัง join ให้ผูก message handler ทันทีแล้วส่ง `sync` เพื่อป้องกันการพลาด state ที่ถูกส่งระหว่าง join handshake

Guest session จองได้ครั้งละหนึ่งห้องและเปลี่ยนห้องได้เฉพาะเมื่อออกจาก lobby ก่อนกด Start เมื่อ host เริ่มแล้ว binding จะถูก commit และ Guest JWT นั้นเข้าห้องเกมอื่นไม่ได้ Browser เก็บ `room.reconnectionToken` ใน `sessionStorage` ของแท็บและเรียก `client.reconnect(token)` หลัง refresh หน้า โดยไม่สร้าง identity ใหม่เพื่อหนีการ forfeit

ทุกบัญชีมี active player-room reservation ได้หนึ่งห้อง Redis ใช้ `SET NX` และ compare-and-delete เพื่อให้ atomic ข้าม realtime replica การหลุดชั่วคราวจะยังคง reservation ระหว่างช่วง reconnect และปล่อยเมื่อออกหรือหมดเวลา ส่วน spectator ไม่จอง player slot

## ข้อความจาก Client ไป Server

| Type | Payload | Phase ที่ใช้ได้ |
| --- | --- | --- |
| `sync` | ไม่มี | ทุก phase |
| `ready` | `true` หรือ `false` | lobby ที่ยังรอ |
| `update-guest-name` | `{ "displayName": "Cipher Guest" }` | lobby ที่ยังรอ, Guest เท่านั้น |
| `update-settings` | `{ preset, turnSeconds, totalCards, drawRounds, jokerCount }` | lobby, host เท่านั้น |
| `start-game` | ไม่มี | lobby, host เท่านั้นและทุกคน ready |
| `rematch` | ไม่มี | จบเกม, host เท่านั้น แล้วกลับ lobby เพื่อตรวจ ready ใหม่ |
| `kick-player` / `transfer-host` | `{ "playerId": "user UUID" }` | lobby, host เท่านั้น |
| `emote` | `{ "emote": "thinking | nice | oops | good-game" }` | ทุก phase ที่อยู่ในห้อง |
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
  "players": "ชื่อ, account type, host, ready และ connection status",
  "droppedPlayerIds": [],
  "serverTimeMs": 0,
  "turnDeadlineMs": "epoch milliseconds หรือ null",
  "game": "viewer-safe game object or null",
  "isSpectator": false
}
```

ระหว่างเลือก ไพ่ตัวเลือกยังซ่อนค่าจนผู้มีสิทธิ์เลือกครบและเปิดเฉพาะใบที่เลือก ไพ่ที่ resolve แล้วจะยังเปิดระหว่าง tie redraw ส่วน `game` มี rack ที่กรองตามผู้ชม จำนวนกองจั่ว current player, phase, starting-card IDs, `pendingStartingJokerCardIds` เฉพาะของผู้ชม, pending draw, winner และเลขเทิร์น เซิร์ฟเวอร์จะไม่ส่ง ID ของ Joker เริ่มต้นที่คว่ำของผู้เล่นอื่น ไพ่คู่แข่งที่ยังไม่เปิดมีเพียง `{ id, kind: "hidden", revealed: false }`

`guest-name-updated` ยืนยันชื่อในห้องหลัง normalize ชื่อ Guest ยาว 1–32 ตัว ต้องไม่ซ้ำกับคนอื่นในห้องตอนแก้ และจะล็อกเมื่อ server รับ Start ผู้เล่นทุกคนมี `accountType` และ client ต้องแสดงป้าย Guest ให้เห็นชัดเพื่อไม่ให้สับสนกับ profile ถาวร

`error` มี `{ "code": "...", "message": "..." }` code ที่คาดได้เช่น `INVALID_MESSAGE`, `INVALID_GUEST_NAME`, `GUEST_ONLY`, `NAME_TAKEN`, `MATCH_ALREADY_STARTED`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `RATE_LIMITED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION` และ `INVALID_TARGET`

ข้อความในห้องถูกจำกัดทั้งต่อ connection และ Redis bucket ต่อ user/วินาทีด้วย `MAX_ROOM_MESSAGES_PER_SECOND` ผลเกมจาก client จะถูกเพิกเฉย มีเพียง authoritative room ที่ตัดสินการเปิดไพ่ การแพ้ และผู้ชนะ
