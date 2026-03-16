"""
Background queue สำหรับ gen examples — ทำงานใน thread แยก
ใช้ rate limiter เดียวกับ Gemini (45/hour, 990/day)
ถ้าชนลิมิต: sleep จนถึงต้นชั่วโมงหน้า แล้วทำต่อ
"""
import queue
import threading
import time
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class ExampleGenerationQueue:
    def __init__(self):
        self._queue: queue.Queue[int] = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="example-queue")
        self._thread.start()

    def enqueue(self, word_id: int):
        self._queue.put(word_id)

    def enqueue_many(self, word_ids: list[int]):
        for wid in word_ids:
            self._queue.put(wid)

    def size(self) -> int:
        return self._queue.qsize()

    # ---- worker ----

    def _sleep_until_next_hour(self):
        now = datetime.now()
        seconds = (60 - now.minute) * 60 - now.second + 5  # +5 buffer
        logger.info(f"[ExampleQueue] hourly limit hit — sleeping {seconds}s")
        time.sleep(seconds)

    def _sleep_until_midnight(self):
        now = datetime.now()
        seconds = (23 - now.hour) * 3600 + (59 - now.minute) * 60 + (60 - now.second) + 5
        logger.info(f"[ExampleQueue] daily limit hit — sleeping {seconds}s")
        time.sleep(seconds)

    BATCH_SIZE = 50

    def _drain_batch(self) -> list[int]:
        """ดึง word_ids ออกจาก queue สูงสุด BATCH_SIZE คำ (non-blocking หลังตัวแรก)"""
        batch = []
        # รอตัวแรก (blocking)
        try:
            batch.append(self._queue.get(timeout=5))
        except queue.Empty:
            return []
        # ดึงที่เหลือแบบ non-blocking
        while len(batch) < self.BATCH_SIZE:
            try:
                batch.append(self._queue.get_nowait())
            except queue.Empty:
                break
        return batch

    def _process_batch(self, word_ids: list[int]):
        from ..database import SessionLocal
        from ..models.word import Word
        from ..models.example import Example
        from ..services.translate_service import batch_generate_examples

        db = SessionLocal()
        try:
            # กรองเฉพาะคำที่ verified และยังไม่มี examples
            existing_ids = {
                row[0] for row in db.query(Example.word_id)
                .filter(Example.word_id.in_(word_ids)).distinct().all()
            }
            words = db.query(Word).filter(
                Word.id.in_(word_ids),
                Word.status == "verified",
                Word.id.notin_(existing_ids),
            ).all()

            if not words:
                return

            word_dicts = [
                {"id": w.id, "chinese": w.chinese, "pinyin": w.pinyin or "",
                 "thai": w.thai_meaning or "", "category": w.category or ""}
                for w in words
            ]

            grouped = batch_generate_examples(word_dicts)

            saved = 0
            for word in words:
                examples = grouped.get(word.id, [])
                if not examples:
                    logger.warning(f"[ExampleQueue] no examples returned for {word.chinese} (id={word.id})")
                    continue
                for idx, ex in enumerate(examples):
                    db.add(Example(
                        word_id=word.id,
                        chinese=ex.get("chinese", ""),
                        pinyin=ex.get("pinyin", ""),
                        thai=ex.get("thai", ""),
                        type=ex.get("type", ""),
                        meaning_line=ex.get("meaning_line", 0),
                        sort_order=idx,
                    ))
                saved += 1
            db.commit()
            logger.info(f"[ExampleQueue] batch saved examples for {saved}/{len(words)} words")
        finally:
            db.close()

    def _worker(self):
        while True:
            batch = self._drain_batch()
            if not batch:
                continue

            while True:  # retry loop ถ้าชนลิมิต
                try:
                    self._process_batch(batch)
                    for _ in batch:
                        self._queue.task_done()
                    break
                except RuntimeError as e:
                    msg = str(e)
                    # put กลับเข้า queue แล้ว sleep
                    for wid in batch:
                        self._queue.put(wid)
                    for _ in batch:
                        self._queue.task_done()
                    if "daily" in msg:
                        self._sleep_until_midnight()
                    else:
                        self._sleep_until_next_hour()
                    break
                except Exception as e:
                    logger.error(f"[ExampleQueue] batch error: {e}")
                    for _ in batch:
                        self._queue.task_done()
                    break


example_queue = ExampleGenerationQueue()
