import os
import time
os.environ.setdefault("TZ", "Asia/Bangkok")
try:
    time.tzset()  # ใช้ได้บน Linux/macOS
except AttributeError:
    pass  # Windows ไม่มี tzset

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine
from .routers import search, words, users, flashcard, admin, notes, auth, subscription, speaking, ocr, handwriting, ocr_notes
from .scheduler import start_scheduler

def _migrate_columns():
    """เพิ่ม column ใหม่ที่ create_all ไม่ได้เพิ่มให้อัตโนมัติ"""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    existing = {c["name"] for c in inspector.get_columns("word_image_cache")}
    with engine.begin() as conn:
        if "image_data" not in existing:
            conn.execute(text("ALTER TABLE word_image_cache ADD COLUMN image_data bytea"))
        if "image_source" not in existing:
            conn.execute(text("ALTER TABLE word_image_cache ADD COLUMN image_source varchar(32)"))
        if "last_accessed_at" not in existing:
            conn.execute(text("ALTER TABLE word_image_cache ADD COLUMN last_accessed_at timestamp DEFAULT now()"))


def _warmup_paddle():
    """โหลด PaddleOCR models ตอน startup เพื่อไม่ให้ user คนแรกต้องรอ download"""
    import logging
    try:
        from .routers.ocr import _get_paddle_reader
        _get_paddle_reader()
        logging.getLogger(__name__).info("[startup] PaddleOCR warmed up")
    except Exception as e:
        logging.getLogger(__name__).warning(f"[startup] PaddleOCR warmup failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
    scheduler = start_scheduler()
    import asyncio, concurrent.futures
    asyncio.get_event_loop().run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _warmup_paddle)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Thai-Chinese Dictionary API", version="1.0.0", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    os.getenv("FRONTEND_URL", ""),
    "https://thaidict.vercel.app",
    "https://believable-passion-production-bc48.up.railway.app",
    # Capacitor Android
    "capacitor://localhost",
    "http://localhost",
    # Capacitor iOS
    "ionic://localhost",
    "https://localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(search.router)
app.include_router(words.router)
app.include_router(users.router)
app.include_router(flashcard.router)
app.include_router(admin.router)
app.include_router(notes.router)
app.include_router(subscription.router)
app.include_router(speaking.router)
app.include_router(ocr.router)
app.include_router(handwriting.router)
app.include_router(ocr_notes.router)


@app.get("/")
def root():
    return {"message": "Thai-Chinese Dictionary API", "docs": "/docs"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
