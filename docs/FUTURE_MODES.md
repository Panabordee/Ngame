# Deferred game modes

This branch is the planning home for rule-changing features that are intentionally excluded from the current production loop. Nothing in this document is authoritative until the open decisions are resolved and `GAME_DESIGN.md` is updated together with server-side tests.

## 2v2 team mode

Proposed direction: four human/bot seats split into two teams with a limited shared hint-token pool.

Open decisions:

- Whether partners may see each other's hidden rack or only exchange constrained hints.
- Hint-token count, legal hint vocabulary, timing, and anti-collusion rules.
- Turn order, elimination behavior, and whether a team loses on one or both racks being revealed.
- Bot partner strategy, reconnect/forfeit handling, rating, and spectator projection.

## Wild/Cipher ability card

Proposed direction: a special card that is not guessed through the normal rank/color or colorless-Joker action and requires a distinct server-authoritative resolution.

Open decisions:

- Deck count and whether it replaces or supplements current Jokers.
- Legal guess/reveal trigger, rack ordering, placement, and information shown to opponents.
- Interaction with a pending draw, empty-pile penalty, timeout, and win condition.
- Bot deduction model and viewer-safe protocol representation.

## Implementation gate

Before implementation, update the English and Thai design documents, shared protocol/types, privacy projections, authoritative engine tests, realtime integration tests, bot soak tests, and player tutorial in the same reviewed change.

---

# โหมดเกมที่เลื่อนไว้

Branch นี้ใช้วางแผนฟีเจอร์ที่เปลี่ยนกติกาและยังไม่รวมใน production loop ปัจจุบัน เนื้อหานี้ยังไม่ใช่กติกาหลักจนกว่าจะตัดสินประเด็นค้างและอัปเดต `GAME_DESIGN.md` พร้อม test ฝั่ง server

## โหมดทีม 2v2

แนวทางเบื้องต้นคือผู้เล่น/บอท 4 ที่นั่งแบ่งสองทีมและใช้ hint token ร่วมกันแบบจำกัด ต้องตัดสินเรื่องข้อมูลที่คู่ทีมเห็น, รูปแบบ hint, turn order, เงื่อนไขแพ้ของทีม, reconnect/forfeit และ bot strategy ก่อนเริ่มทำ

## ไพ่ Wild/Cipher แบบมีความสามารถ

แนวทางเบื้องต้นคือไพ่พิเศษที่ไม่ใช้การเดา rank/color หรือ Joker ปัจจุบัน ต้องตัดสินจำนวนไพ่, วิธีเปิด/เดา, การเรียง rack, interaction กับ pending draw/กองจั่วหมด/timeout, เงื่อนไขชนะ และข้อมูลที่ส่งให้ client ก่อนเริ่มทำ
