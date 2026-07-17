# NGAME / CipherDeck

NGAME คือเกมไพ่ deduction บนเบราว์เซอร์ที่ใช้เซิร์ฟเวอร์เป็นผู้ตัดสินกติกาทั้งหมด MVP ปัจจุบันรองรับห้องผู้เล่นที่ยืนยันตัวตนแล้ว 3–6 คน มีทั้ง Quick Match และห้องเลข 6 หลัก ใช้ไพ่มาตรฐาน 52 ใบพร้อม Joker 2–4 ใบ มี state ส่วนตัวแยกตามผู้เล่น และรองรับการเชื่อมต่อกลับ/แพ้เพราะหลุดจากเกม

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

## ตรวจระบบแบบรวดเร็ว

```bash
npm ci
npm run typecheck
npm test
python -m pip install -e 'backend[dev]'
python -m pytest backend/tests
npm run build --workspace @ngame/client
```

ต้องใช้ Node.js 24.18 ขึ้นไปและ Python 3.12 ขึ้นไป เป้าหมาย production คือ Ubuntu Server 24.04 LTS VM บน Proxmox รันด้วย Docker Compose และรับ traffic ผ่าน Nginx reverse proxy ภายนอก

เมื่อเปิด API และ realtime server บนเครื่องแล้ว ใช้ `npm run smoke:local --workspace @ngame/server` เพื่อทดสอบ auth, matchmaking, ความเป็นส่วนตัวของไพ่, action และห้องเลขด้วยผู้เล่นจำลอง 3 คน
