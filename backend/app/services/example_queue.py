"""
Background queue สำหรับ gen examples — ทำงานใน thread แยก
ใช้ rate limiter เดียวกับ Gemini (40/hour, 900/day)
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

    def _process(self, word_id: int):
        from ..database import SessionLocal
        from ..models.word import Word
        from ..models.example import Example
        from ..services.translate_service import generate_examples_for_word

        db = SessionLocal()
        try:
            word = db.query(Word).filter(Word.id == word_id).first()
            if not word or word.status != "verified":
                return
            if db.query(Example).filter(Example.word_id == word_id).count() > 0:
                return  # มี examples แล้ว ข้ามไป

            examples = generate_examples_for_word(
                word.chinese, word.pinyin or "", word.thai_meaning or "", word.category or ""
            )
            for idx, ex in enumerate(examples):
                db.add(Example(
                    word_id=word.id,
                    chinese=ex.get("chinese", ""),
                    pinyin=ex.get("pinyin", ""),
                    thai=ex.get("thai", ""),
                    meaning_line=ex.get("meaning_line", 0),
                    order=idx,
                ))
            db.commit()
            logger.info(f"[ExampleQueue] generated {len(examples)} examples for {word.chinese} (id={word_id})")
        finally:
            db.close()

    def _worker(self):
        while True:
            try:
                word_id = self._queue.get(timeout=5)
            except queue.Empty:
                continue

            while True:  # retry loop ถ้าชนลิมิต
                try:
                    self._process(word_id)
                    self._queue.task_done()
                    break
                except RuntimeError as e:
                    msg = str(e)
                    # put กลับเข้า queue แล้ว sleep
                    self._queue.put(word_id)
                    self._queue.task_done()
                    if "daily" in msg:
                        self._sleep_until_midnight()
                    else:
                        self._sleep_until_next_hour()
                    break
                except Exception as e:
                    logger.error(f"[ExampleQueue] error word_id={word_id}: {e}")
                    self._queue.task_done()
                    break


example_queue = ExampleGenerationQueue()
