# ข้อจำกัดที่ทราบใน MVP ปัจจุบัน

- Browser client เป็น UI สำหรับเล่นและตรวจระบบ ยังไม่ใช่งาน visual design ขั้นสุดท้าย
- Live room state รองรับ client หลุด 30 วินาที แต่ยังไม่รอดจาก realtime container หรือ VM crash
- มี Redis container เตรียมไว้สำหรับ distributed matchmaking, rate limit และ room snapshot แต่ room แบบ process เดียวยังไม่ได้ใช้
- ยังไม่มี completed-match persistence, match history, leaderboard และ realtime-to-API result endpoint
- ต้องปิด production email registration จนกว่าจะมี SMTP, email verification, password reset และ endpoint rate limit ส่วน local password auth เปิดไว้สำหรับทดสอบ
- มีโค้ด Google sign-in แล้ว แต่ต้องใช้ Google credential จริงและตั้ง origin/callback ที่ถูกต้องจึงจะทดสอบได้
- ข้อความใน realtime room มี rate limit แล้ว แต่ distributed abuse control ของ FastAPI auth endpoint ยังเป็นงานที่ต้องทำก่อนเปิดสาธารณะ
- MVP ยังไม่มี mobile-specific behavior, Steamworks integration หรือระบบชำระเงิน
