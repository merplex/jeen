# พจนานุกรมจีน-ไทย

แอปพจนานุกรมจีน-ไทย รองรับ iOS/Android ผ่าน React Web App

---

## รันใน Codespace (ทดสอบ)

### 1. เริ่ม Database
```bash
docker compose up -d postgres
```

### 2. เริ่ม Backend
```bash
cd backend
cp .env.example .env   # แก้ค่าใน .env ตามต้องการ
uvicorn app.main:app --reload --port 8000
```

### 3. เริ่ม Frontend
```bash
cd frontend
npm run dev -- --host --port 3000
```

เปิด Ports tab → Port 3000 → คลิก Open Browser

---

## Deploy บน Railway

### ขั้นตอน

1. **Push โค้ดขึ้น GitHub**
   ```bash
   git add .
   git commit -m "Initial setup"
   git push
   ```

2. **สร้าง Railway Project**
   - ไปที่ [railway.app](https://railway.app)
   - New Project → Deploy from GitHub repo → เลือก repo นี้

3. **เพิ่ม PostgreSQL**
   - ใน Project → Add Plugin → PostgreSQL
   - Railway จะสร้าง `DATABASE_URL` อัตโนมัติ

4. **สร้าง Backend Service**
   - New Service → GitHub Repo → เลือก repo นี้
   - Settings → Root Directory: `backend`
   - Environment Variables:
     ```
     DATABASE_URL      = (copy จาก PostgreSQL plugin)
     GEMINI_API_KEY    = your_key
     ADMIN_IDENTIFIERS = your_lineid,your@email.com
     JWT_SECRET        = random_long_string_here
     JWT_EXPIRE_HOURS  = 720
     FRONTEND_URL      = https://your-frontend.up.railway.app
     ```

5. **สร้าง Frontend Service**
   - New Service → GitHub Repo → เลือก repo นี้อีกครั้ง
   - Settings → Root Directory: `frontend`
   - Environment Variables:
     ```
     VITE_API_URL = https://your-backend.up.railway.app
     ```

6. **ได้ URL** → แชร์ให้ผู้ใช้ได้เลย

**ค่าใช้จ่าย:** ~$5/เดือน (ประมาณ 180 บาท) สำหรับ Backend + PostgreSQL
Frontend ใช้ Vercel ฟรีได้ถ้าต้องการประหยัด

---

## Import ไฟล์คำศัพท์

1. Login ด้วย Admin account
2. ไปหน้า Admin → Import
3. อัปโหลดไฟล์ .xlsx หรือ .csv
4. ไปที่ "รอ Approve" เพื่อ Approve ทีละคำหรือทีละ batch

คอลัมน์ที่รองรับ: chinese/จีน, pinyin/พินอิน, thai/ความหมาย, english, category/หมวด

---

## Tech Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | React + Vite + Tailwind CSS + Zustand |
| Backend | FastAPI + SQLAlchemy + Alembic |
| Database | PostgreSQL |
| AI | Google Gemini 1.5 Flash |
| Deploy | Railway + (Vercel optional) |
