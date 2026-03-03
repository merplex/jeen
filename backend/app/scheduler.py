import logging
import time
from sqlalchemy import or_, select
from apscheduler.schedulers.background import BackgroundScheduler

from .database import SessionLocal
from .models.word import Word
from .models.example import Example
from .models.activity_log import ActivityLog
from .services.translate_service import batch_generate_english, generate_examples_for_word

logger = logging.getLogger(__name__)


def _job_gen_english():
    """สร้าง english_meaning ให้ verified words ที่ยังไม่มี (batch 20 คำ/รอบ)"""
    db = SessionLocal()
    try:
        words = (
            db.query(Word)
            .filter(Word.status == "verified")
            .filter(or_(Word.english_meaning.is_(None), Word.english_meaning == ""))
            .limit(20)
            .all()
        )
        if not words:
            return

        batch = [{"id": w.id, "chinese": w.chinese, "thai": w.thai_meaning or ""} for w in words]
        results = batch_generate_english(batch)

        done = 0
        for item in results:
            word = next((w for w in words if w.id == item.get("id")), None)
            if word and item.get("english"):
                word.english_meaning = item["english"]
                done += 1

        if done > 0:
            db.add(ActivityLog(action="bulk_english", detail=f"[auto] อัปเดต {done} คำ"))
            db.commit()
            logger.info(f"[scheduler:english] generated for {done} words")
    except Exception as e:
        logger.error(f"[scheduler:english] error: {e}")
    finally:
        db.close()


def _job_gen_examples():
    """สร้าง examples ให้ verified words ที่ยังไม่มี (ทีละ 3 คำ/รอบ)"""
    db = SessionLocal()
    try:
        words = (
            db.query(Word)
            .filter(Word.status == "verified")
            .filter(Word.id.notin_(select(Example.word_id).distinct()))
            .limit(3)
            .all()
        )
        if not words:
            return

        done = 0
        for word in words:
            try:
                examples = generate_examples_for_word(
                    word.chinese, word.pinyin or "", word.thai_meaning or ""
                )
                if examples:
                    for idx, ex in enumerate(examples):
                        db.add(Example(
                            word_id=word.id,
                            chinese=ex.get("chinese", ""),
                            pinyin=ex.get("pinyin"),
                            thai=ex.get("thai"),
                            type=ex.get("type"),
                            meaning_line=ex.get("meaning_line", 0),
                            sort_order=idx,
                        ))
                    db.commit()
                    done += 1
            except Exception as e:
                logger.warning(f"[scheduler:examples] {word.chinese}: {e}")
            time.sleep(0.5)

        if done > 0:
            db.add(ActivityLog(action="bulk_examples", detail=f"[auto] สร้างตัวอย่าง {done} คำ"))
            db.commit()
            logger.info(f"[scheduler:examples] generated for {done} words")
    except Exception as e:
        logger.error(f"[scheduler:examples] error: {e}")
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="Asia/Bangkok")
    scheduler.add_job(_job_gen_english, "interval", minutes=5, id="gen_english", max_instances=1)
    scheduler.add_job(_job_gen_examples, "interval", minutes=15, id="gen_examples", max_instances=1)
    scheduler.start()
    logger.info("[scheduler] started — english every 5m, examples every 15m")
    return scheduler
