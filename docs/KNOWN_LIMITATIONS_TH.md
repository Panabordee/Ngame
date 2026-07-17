# ข้อจำกัดที่ทราบใน MVP ปัจจุบัน

- Browser client เป็น UI สำหรับเล่นและตรวจระบบ ยังไม่ใช่งาน visual design ขั้นสุดท้าย
- Live room state รองรับ client หลุด 30 วินาที แต่ยังไม่รอดจาก realtime container หรือ VM crash
- มี Redis container เตรียมไว้สำหรับ distributed matchmaking, rate limit และ room snapshot แต่ room แบบ process เดียวยังไม่ได้ใช้
- เลขห้อง 6 หลักใช้เพื่อค้นหาห้อง ไม่ใช่ secret สำหรับควบคุมสิทธิ์ และรับประกันว่าไม่ซ้ำภายใน realtime process เดียวเท่านั้น หาก scale หลาย process ต้องย้าย registry ไปใช้ Redis แบบ atomic
- ระบบกันบัญชีซ้ำทำงานภายในห้องเดียว แต่บัญชีเดียวกันยังเปิดหลายแท็บเพื่อจองที่นั่งคนละห้องได้ ควรเพิ่ม presence reservation บน Redis ก่อนเปิด public matchmaking ให้ผู้ใช้ภายนอก
- ยังไม่มี completed-match persistence, match history, leaderboard และ realtime-to-API result endpoint
- Action timer ทำงานฝั่ง server ระหว่างวาง Joker เริ่มต้นและการเล่นปกติแล้ว แต่ช่วงเลือกไพ่ 6 ใบเพื่อหาคนเริ่มยังไม่มี AFK timeout ผู้เล่นหนึ่งคนจึงทำให้ขั้นเลือกนี้ค้างได้จนกว่าจะเลือกหรือหลุด
- Profile รองรับ display name, username และ URL รูปจาก Google แต่ยังอัปโหลด avatar เองไม่ได้
- Google sign-in ต้องใช้ credential จริงและตั้ง origin/callback ให้ตรง Automated test ใช้ provider stub จึงตรวจ Google tenant จริงไม่ได้
- ข้อความใน realtime room มี rate limit แล้ว แต่ distributed abuse control ของ FastAPI auth endpoint ยังเป็นงานที่ต้องทำก่อนเปิดสาธารณะ
- MVP ยังไม่มี mobile-specific behavior, Steamworks integration หรือระบบชำระเงิน
