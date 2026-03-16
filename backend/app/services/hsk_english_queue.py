"""
Background worker สำหรับ regen english_meaning ของคำ HSK ทั้งหมด
- สั่ง start/stop ได้จาก admin endpoint
- ทำงานใน daemon thread — ปิดหน้าจอได้เลย
- ชน rate limit → sleep จนต้นชั่วโมงหน้า แล้วทำต่อ
"""
import threading
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


class HskEnglishQueue:
    def __init__(self):
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self._offset = 0
        self._total = 0
        self._done = 0
        self._errors = 0

    def start(self):
        with self._lock:
            if self._running:
                return False  # already running
            # ถ้าทำจบแล้ว (offset >= total) ให้เริ่มใหม่ ไม่งั้น resume จาก offset ที่ค้างไว้
            if self._total > 0 and self._offset >= self._total:
                self._offset = 0
                self._done = 0
                self._errors = 0
            self._running = True
            self._thread = threading.Thread(target=self._worker, daemon=True, name="hsk-english-queue")
            self._thread.start()
            return True

    def stop(self):
        with self._lock:
            self._running = False

    def status(self) -> dict:
        with self._lock:
            return {
                "running": self._running,
                "offset": self._offset,
                "total": self._total,
                "done": self._done,
                "errors": self._errors,
            }

    def _sleep_until_next_hour(self):
        now = datetime.now()
        seconds = (60 - now.minute) * 60 - now.second + 5
        logger.info(f"[HskEnglishQueue] hourly limit hit — sleeping {seconds}s")
        # sleep in small chunks so stop() takes effect quickly
        for _ in range(seconds):
            with self._lock:
                if not self._running:
                    return
            time.sleep(1)

    def _sleep_until_midnight(self):
        now = datetime.now()
        seconds = (23 - now.hour) * 3600 + (59 - now.minute) * 60 + (60 - now.second) + 5
        logger.info(f"[HskEnglishQueue] daily limit hit — sleeping {seconds}s")
        for _ in range(seconds):
            with self._lock:
                if not self._running:
                    return
            time.sleep(1)

    def _worker(self):
        from ..database import SessionLocal
        from ..models.word import Word
        from ..services.translate_service import batch_generate_english

        # get total once
        db = SessionLocal()
        try:
            total = db.query(Word).filter(
                Word.status == "verified",
                Word.hsk_level.isnot(None),
                Word.hsk_level != "",
            ).count()
        finally:
            db.close()

        with self._lock:
            self._total = total

        logger.info(f"[HskEnglishQueue] starting — {total} HSK words to process")

        while True:
            with self._lock:
                if not self._running:
                    break
                offset = self._offset

            db = SessionLocal()
            try:
                words = (
                    db.query(Word)
                    .filter(Word.status == "verified", Word.hsk_level.isnot(None), Word.hsk_level != "")
                    .order_by(Word.id)
                    .offset(offset)
                    .limit(BATCH_SIZE)
                    .all()
                )

                if not words:
                    logger.info(f"[HskEnglishQueue] finished — processed {self._done} words")
                    with self._lock:
                        self._running = False
                    break

                batch = [{"id": w.id, "chinese": w.chinese, "thai": w.thai_meaning or ""} for w in words]

                try:
                    results = batch_generate_english(batch)
                except RuntimeError as e:
                    msg = str(e)
                    if "daily" in msg:
                        self._sleep_until_midnight()
                    else:
                        self._sleep_until_next_hour()
                    continue  # retry same offset

                done_batch = 0
                errors_batch = 0
                for item in results:
                    word = next((w for w in words if w.id == item.get("id")), None)
                    if not word:
                        continue
                    new_eng = item.get("english", "").strip()
                    if not new_eng:
                        errors_batch += 1
                        continue
                    word.english_meaning = new_eng
                    thai_addition = str(item.get("thai_addition", "")).strip()
                    if thai_addition and thai_addition not in (word.thai_meaning or ""):
                        word.thai_meaning = (word.thai_meaning or "") + "\n" + thai_addition
                    done_batch += 1

                errors_batch += len(words) - len(results) if results else len(words)
                db.commit()

                with self._lock:
                    self._offset = offset + len(words)
                    self._done += done_batch
                    self._errors += errors_batch

                logger.info(f"[HskEnglishQueue] batch offset={offset} done={done_batch} errors={errors_batch} total_done={self._done}/{total}")

            except Exception as e:
                logger.error(f"[HskEnglishQueue] batch error at offset={offset}: {e}")
                with self._lock:
                    self._offset = offset + BATCH_SIZE  # skip batch แล้วไปต่อ
            finally:
                db.close()

            time.sleep(0.5)  # เว้นเล็กน้อยระหว่าง batch

        logger.info("[HskEnglishQueue] worker exited")


hsk_english_queue = HskEnglishQueue()
