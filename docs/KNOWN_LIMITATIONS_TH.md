# ข้อจำกัดที่ทราบใน MVP ปัจจุบัน

- Browser client เป็น UI สำหรับเล่นและตรวจระบบ ยังไม่ใช่งาน visual design ขั้นสุดท้าย
- Live room state รองรับ client หลุด 30 วินาที และบันทึก authoritative checkpoint ใน Redis หนึ่งชั่วโมง แต่การสร้างห้องและพา client กลับอัตโนมัติหลัง container/VM crash ยังต้องมี orchestrator
- Redis ใช้กับ Colyseus presence/room discovery, rate bucket ต่อ user, recovery checkpoint และคิว retry ผลแมตช์แล้ว
- เลขห้อง 6 หลักใช้เพื่อค้นหาห้อง ไม่ใช่ secret สำหรับควบคุมสิทธิ์ และรับประกันว่าไม่ซ้ำภายใน realtime process เดียวเท่านั้น หาก scale หลาย process ต้องย้าย registry ไปใช้ Redis แบบ atomic
- active-player reservation บน Redis ป้องกันบัญชีเดียวจองที่นั่งผู้เล่นหลายห้องข้าม realtime replica แล้ว แต่ยังอนุญาตให้ดูอีกห้องเป็น spectator เพราะส่ง game action ไม่ได้
- มี completed-match persistence, lifetime statistics, achievements, recent history และ leaderboard รายซีซัน/ตลอดกาลแล้ว แต่ rating ยังเป็นสูตร provisional ไม่ใช่ Elo/Glicko
- Action timer ทำงานฝั่ง server ทั้งตอนเลือกไพ่เริ่มต้น วาง Joker และเล่นปกติ หากหมดเวลาตอนเลือกไพ่ ระบบสุ่มตัวเลือกที่เหลือให้
- Profile รองรับ display name, username และ URL รูปจาก Google แต่ยังอัปโหลด avatar เองไม่ได้
- Google sign-in ต้องใช้ credential จริงและตั้ง origin/callback ให้ตรง Automated test ใช้ provider stub จึงตรวจ Google tenant จริงไม่ได้
- ข้อความใน realtime room มี rate limit แล้ว แต่ distributed abuse control ของ FastAPI auth endpoint ยังเป็นงานที่ต้องทำก่อนเปิดสาธารณะ
- การผูก Guest หนึ่งเกมและการจองเลขห้องยังอยู่ใน process แม้ room discovery ใช้ Redis แล้ว ต้องเปลี่ยนสองส่วนนี้เป็น Redis atomic operation ก่อนเปิดหลาย writable realtime replicas
- มือถือรองรับการเล่นแนวนอนและมี automated viewport test แล้ว แต่ยังต้องทดสอบบนอุปกรณ์จริงและ browser หลายรุ่น ส่วน Steamworks และระบบชำระเงินยังอยู่นอก scope
