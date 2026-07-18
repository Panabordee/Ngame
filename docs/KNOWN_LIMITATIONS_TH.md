# ข้อจำกัดที่ทราบใน MVP ปัจจุบัน

- Browser client เป็น UI สำหรับเล่นและตรวจระบบ ยังไม่ใช่งาน visual design ขั้นสุดท้าย
- Live room state รองรับ client หลุด 30 วินาที และบันทึก authoritative checkpoint ใน Redis หนึ่งชั่วโมง แต่การสร้างห้องและพา client กลับอัตโนมัติหลัง container/VM crash ยังต้องมี orchestrator
- Redis ใช้กับ Colyseus presence/room discovery, rate bucket ต่อ user, recovery checkpoint, คิว retry ผลแมตช์, การจองเลขห้องแบบ atomic และ API rate limit แล้ว
- เลขห้อง 6 หลักใช้เพื่อค้นหาห้อง ไม่ใช่ secret สำหรับควบคุมสิทธิ์ และไม่ซ้ำข้าม realtime replica เมื่อเชื่อม Redis
- active-player reservation บน Redis ป้องกันบัญชีเดียวจองที่นั่งผู้เล่นหลายห้องข้าม realtime replica แล้ว แต่ยังอนุญาตให้ดูอีกห้องเป็น spectator เพราะส่ง game action ไม่ได้
- มี completed-match persistence, lifetime statistics, achievements, recent history และ leaderboard รายซีซัน/ตลอดกาลแล้ว แต่ rating ยังเป็นสูตร provisional ไม่ใช่ Elo/Glicko
- Action timer ทำงานฝั่ง server ทั้งตอนเลือกไพ่เริ่มต้น วาง Joker และเล่นปกติ หากหมดเวลาตอนเลือกไพ่ ระบบสุ่มตัวเลือกที่เหลือให้
- Profile รองรับ display name, username และ URL รูปจาก Google แต่ยังอัปโหลด avatar เองไม่ได้
- Google sign-in ต้องใช้ credential จริงและตั้ง origin/callback ให้ตรง Automated test ใช้ provider stub จึงตรวจ Google tenant จริงไม่ได้
- ทั้งข้อความ realtime และ FastAPI request มี rate limit โดย API ใช้ Redis ใน Compose/production และใช้หน่วยความจำตอน local
- การผูก Guest หนึ่งเกม, การจองที่นั่งของบัญชีปกติ และเลขห้องใช้ Redis แบบ atomic ข้าม realtime replica เมื่อเชื่อม Redis
- มือถือรองรับการเล่นแนวนอนและมี automated viewport test แล้ว แต่ยังต้องทดสอบบนอุปกรณ์จริงและ browser หลายรุ่น ส่วน Steamworks และระบบชำระเงินยังอยู่นอก scope
