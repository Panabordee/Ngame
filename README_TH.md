# NGAME / CipherDeck

NGAME คือเกมไพ่ deduction บนเบราว์เซอร์ที่ใช้เซิร์ฟเวอร์เป็นผู้ตัดสินทั้งหมด เล่นคนเดียวกับบอทได้ รองรับ Quick Match และห้องเลข 3–6 ที่นั่ง, เครื่องมือ Host/ready, ธีม 4 แบบ, ภาษาอังกฤษ/ไทย, สมุดจด deduction, ประวัติการเดา, Daily Cipher, achievements, leaderboard รายซีซัน, replay/แชร์ผล, เพื่อนและลิงก์ปาร์ตี้, emote สำเร็จรูป และ spectator ที่ไม่เห็นข้อมูลไพ่ลับ ระบบ production ใช้ Redis ประสาน room discovery หลาย instance และพักผลแมตช์ไว้เมื่อ API ล่มชั่วคราว

หน้าโต๊ะบนมือถือออกแบบให้เล่นแนวนอน รองรับ safe area, ย่อ rack คู่แข่ง, มี action dock ติดด้านล่างและ guess picker ที่ไม่หลุด viewport หากถือแนวตั้งระบบจะแนะนำให้หมุนเครื่อง

## ลิงก์สำคัญ

- [สารบัญเอกสารสองภาษา](docs/README.md)
- [กติกาเกม](docs/GAME_RULES_TH.md)
- [การพัฒนาและรันบนเครื่อง](docs/LOCAL_DEVELOPMENT_TH.md)
- [Docker, การ build และ deploy](docs/BUILD_AND_DEPLOY_TH.md)
- [พอร์ตที่ใช้](docs/PORTS_TH.md)
- [ตัวแปร environment](docs/ENVIRONMENT_TH.md)
- [Realtime protocol](docs/REALTIME_PROTOCOL_TH.md)
- [โครงสร้างโปรเจกต์](docs/PROJECT_STRUCTURE_TH.md)
- [สถาปัตยกรรม authentication](docs/architecture/AUTHENTICATION_TH.md)
- [สถาปัตยกรรม deploy บน Proxmox](docs/architecture/DEPLOYMENT_TH.md)
- [ข้อจำกัดที่ทราบใน MVP](docs/KNOWN_LIMITATIONS_TH.md)
- [รายการสิ่งที่จะทำต่อ](docs/ROADMAP_TH.md)

## ตรวจระบบแบบรวดเร็ว

```bash
npm ci
npm run typecheck
npm test
npm run test:mobile --workspace @ngame/client
python -m pip install -e 'backend[dev]'
python -m pytest backend/tests
npm run build --workspace @ngame/client
```

ต้องใช้ Node.js 24.18 ขึ้นไปและ Python 3.12 ขึ้นไป เป้าหมาย production คือ Ubuntu Server 24.04 LTS VM บน Proxmox รันด้วย Docker Compose และรับ traffic ผ่าน Nginx reverse proxy ภายนอก

เมื่อเปิด API และ realtime server บนเครื่องแล้ว ใช้ `npm run smoke:local --workspace @ngame/server` เพื่อทดสอบ signed JWT, host/ready, การเลือกคนเริ่ม, ความเป็นส่วนตัว, action และห้องเลขด้วยผู้เล่นจำลอง 3 คน ส่วน backend/realtime tests ตรวจ Google authentication, Guest JWT, การจำกัด Guest หนึ่งเกม, profile และ refresh session

ใช้ `npm run soak:bots --workspace @ngame/server` เพื่อจำลองแมตช์บอทซ้ำหลายรอบและตรวจ phase ค้างหรือ transition ที่ผิดกติกา
