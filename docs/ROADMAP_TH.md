# Product backlog ของ CipherDeck (ฉบับร่าง)

เอกสารนี้ใช้จด feature ที่ต้องการในอนาคต ยังไม่เปลี่ยนกติกาหลักใน `GAME_DESIGN.md` จนกว่าจะคุยรายละเอียดที่ค้างและย้าย feature นั้นไปเป็นข้อกำหนดจริง

สถานะ 2026-07-19: ข้อ 1–9 ทำแล้ว ระบบ deck admin ใช้ endpoint ที่ตรวจข้อมูลและจำกัด role พร้อม audit log ส่วนไฟล์ภาพจริงเก็บใน object storage กติกาหลักอยู่ใน `GAME_DESIGN.md`

## ลำดับทำที่แนะนำ

1. แก้ UX เล็กที่กระทบการเล่นทันที: Enter เพื่อเข้าห้อง, ชื่อ opponent, guess picker ใหม่ และซ่อนปุ่ม Sync
2. ทำ host, ready/manual start และ room settings
3. ทำ phase สุ่มคนเริ่มพร้อมการวางไพ่เปิด/Joker
4. ทำ `/admin` และระบบสำรับ/งานภาพ
5. ทำ username, avatar และ player profile แบบเต็มเป็นงานท้าย

## 1. Admin และระบบสำรับ/งานภาพ

- มี route `/admin` และ API ฝั่ง FastAPI ที่เข้าได้เฉพาะ role `admin`
- ไม่ทำช่องรัน SQL หรือแก้ database โดยตรงจาก browser ให้ใช้ฟอร์มที่ validate แล้ว, permission แยกตาม action และ audit log ทุกการแก้ไข
- Admin สร้าง/แก้/ปิดใช้งาน deck theme, อัปโหลด card back/Joker/face art, preview และเลือก theme ที่เปิดให้ใช้ได้
- เก็บไฟล์ภาพใน object storage หรือ volume; PostgreSQL เก็บ metadata, URL, checksum, version และผู้แก้ไข ไม่เก็บไฟล์ภาพก้อนใหญ่ใน column
- รุ่นแรกให้ “สำรับใหม่” หมายถึง visual theme เท่านั้น การเปลี่ยนจำนวน/ชนิดไพ่เป็น game-rule preset แยกต่างหากและต้องตรวจ server-side

### ขนาดไฟล์ภาพมาตรฐาน

| งาน | ขนาด | อัตราส่วน | หมายเหตุ |
| --- | ---: | ---: | --- |
| Master สำหรับเก็บ/แก้ | `1024 × 1536 px` | `2:3` | PNG หรือ WebP lossless, sRGB |
| Runtime ในเกม | `512 × 768 px` | `2:3` | WebP, เป้าหมายไม่เกิน `2 MB` ต่อไฟล์ |
| Thumbnail ใน admin | `160 × 240 px` | `2:3` | WebP |

- เว้น safe area อย่างน้อย `64 px` ใน master หรือ `32 px` ใน runtime
- ไม่วาดมุมโค้ง/เงาลงในภาพ เพราะ client ทำ mask และ shadow ด้วย CSS
- `cipher-card-back.webp` ปัจจุบันมีขนาด `512 × 768 px` และใช้เป็น reference ได้
- Deck theme ขั้นต่ำต้องมี card back หนึ่งภาพ ถ้าจะเปลี่ยนหน้าไพ่เต็มชุดต้องระบุ asset mapping ของ 52 ใบและ Joker แยกให้ครบ

โครงสร้างข้อมูลที่คาดไว้: `card_decks`, `card_assets`, `admin_audit_logs` และ role/permission ของผู้ดูแล

## 2. Username และ player profile (ทำท้าย)

- ระยะสั้นใช้ชื่อจาก Google profile ที่เซิร์ฟเวอร์ยืนยันแล้วแทน UUID ในห้อง
- ระยะเต็มให้ตั้ง display name, unique username, avatar และข้อมูล profile ที่อนุญาต
- ต้องมี validation, reserved words, moderation และ rate limit ตอนเปลี่ยนชื่อ
- Client ห้ามส่งชื่อมาแล้วให้ realtime เชื่อทันที ชื่อต้องมาจาก access token หรือ API ที่ผ่านการยืนยัน

หมายเหตุ: ก่อนแก้ opponent แสดง UUID ที่ตัดเหลือ 8 ตัว ไม่ใช่ข้อความ encrypt ปัจจุบันโต๊ะแสดงชื่อที่ server ยืนยันแล้ว

## 3. Room settings ก่อนเริ่มเกม

Host ตั้งค่าและ server broadcast ให้ทุกคนเห็น จากนั้น lock ค่าเมื่อเริ่ม match:

- เวลาต่อเทิร์น Off / 30 / 60 / 90 / 120 / 180 / 300 วินาที
- จำนวนผู้เล่น 3–6 คน
- จำนวนไพ่เริ่มต้นหรือ preset การแจก
- จำนวนรอบที่ต้องเหลือให้จั่ว หรือ draw reserve
- Deck visual theme ที่อนุญาต

Quick Match ต้องจับคู่เฉพาะห้องที่ใช้ preset เดียวกัน หรือใช้ preset มาตรฐานเพียงชุดเดียว

Quick Match ใช้ Classic ส่วนห้องส่วนตัวใช้ Custom ได้ตั้งแต่ไพ่รวม 24–56 ใบ, รอบจั่ว 1–8, Joker 2–4 และเวลาแบบที่ server ตรวจรับ กติกาหมดเวลาอยู่ใน `GAME_DESIGN.md`

## 4. Host กดเริ่มเกมแทน auto-start

- ผู้สร้างห้องเป็น host และมีปุ่ม `Start game`
- ยกเลิกการเริ่มอัตโนมัติเมื่อผู้เล่นครบ
- เริ่มได้เมื่อมีผู้เล่นอย่างน้อย 3 คน, ทุกคน ready และจำนวนไม่เกินค่าห้อง
- ถ้า host ออกจากห้องก่อนเริ่ม ให้โอน host ตามลำดับ join
- เมื่อกดเริ่ม server ต้อง lock ห้องและ settings แล้วจึงเข้า phase เลือกคนเริ่ม

## 5. Phase สุ่มคนเริ่มด้วยไพ่ 6 ใบ

- Server เตรียมไพ่คว่ำ 6 ใบให้ผู้เล่นเลือกคนละหนึ่งใบโดยไม่ซ้ำ
- เปิดพร้อมกันเมื่อทุกคนเลือกแล้ว ไพ่สูงสุดเป็นผู้เริ่ม; Joker สูงกว่าไพ่มาตรฐาน
- ไพ่ที่แต่ละคนเลือกจะเข้า rack ของคนนั้นแบบเปิด และต้องอยู่ในตำแหน่งที่ถูกต้อง
- ถ้ามีผู้เล่นน้อยกว่า 6 คน ไพ่ที่ไม่ถูกเลือกต้องกลับเข้าสำรับและ shuffle โดย server
- เพื่อไม่ให้จำนวนไพ่เพิ่มขึ้นโดยไม่ตั้งใจ ควรนับไพ่ใบนี้เป็นส่วนหนึ่งของ initial hand

ถ้าหน้าสูงสุดเสมอกันหรือได้ Joker หลายคน ให้เฉพาะคนที่เสมอเลือกใหม่จากไพ่ใหม่ 6 ใบ และเปิดไพ่พร้อมกันหลังผู้มีสิทธิ์เลือกครบ

## 6. วาง Joker ตอนเริ่มเกม

- ถ้าไพ่เลือกคนเริ่มเป็น Joker ผู้เล่นเลือกช่องใดใน rack ก็ได้
- ไพ่ยังคงเปิดอยู่ และ server เป็นผู้ validate/บันทึกตำแหน่ง
- Engine ปัจจุบันรองรับ Joker ทุกตำแหน่งอยู่แล้ว แต่ต้องเพิ่ม UI และ phase สำหรับการเลือกตำแหน่งก่อนเริ่มเทิร์นแรก

## 7. แสดงชื่อ opponent

- เพิ่ม display name ที่ผ่านการยืนยันเข้า authenticated room metadata
- แสดงชื่อ, host/ready/disconnected status และใช้ UUID เฉพาะภายใน
- ระวังชื่อซ้ำและชื่อยาว; UI ต้องมี fallback เช่น `Player • A1B2`

## 8. กด Enter เพื่อเข้าห้องเลข

- ครอบช่องเลขห้องด้วย `<form>` และใช้ `onSubmit`
- Enter ต้องทำงานเหมือนปุ่ม `Join code`
- ขณะ connecting ให้ป้องกัน submit ซ้ำ และแสดง error ใต้ช่องกรอก

## 9. Guess picker แบบ contextual

- เมื่อกดไพ่ opponent ให้เปิด popover ติดกับไพ่ใบนั้น ไม่แสดง control กองอยู่ด้านล่าง
- ขั้นแรกเลือก rank (`A`–`K`) หรือ `JOKER`
- เมื่อเลือก rank มาตรฐานแล้วจึงแสดงตัวเลือก `แดง` / `ดำ`
- แสดงสรุป เช่น `เดา: 4 ดำ` แล้วกด Confirm; กด Escape/นอก popover เพื่อยกเลิก
- Popover ห้ามเปิดข้อมูลจริงของไพ่ซ่อน และ server ยังเป็นผู้ตัดสินผลเพียงผู้เดียว

## ปุ่ม Sync คืออะไร

`Sync` ส่ง message ไปขอ state ล่าสุดจาก Colyseus แล้ว server ส่ง snapshot ที่กรองตามผู้เล่นกลับมา ปุ่มนี้:

- ไม่ได้ save ลง database
- ไม่ได้เปลี่ยนเทิร์น, จั่วไพ่ หรือแก้ผลเกม
- ใช้กันกรณีพลาด state ตอน join และช่วยหลัง reconnect

ปัจจุบัน client ส่ง Sync อัตโนมัติหลัง join และ reconnect อยู่แล้ว จึงควรถอดปุ่มออกจาก toolbar ผู้เล่น และเก็บคำสั่งนี้ไว้ภายใน networking layer หรือ developer/debug menu เท่านั้น
