import json
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Body
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import shutil, tempfile, os, time
from sqlalchemy import select, or_
from pypinyin import lazy_pinyin
from ..database import get_db
from ..models.word import Word, WordPending
from ..models.example import Example
from ..models.missed_search import MissedSearch
from ..models.activity_log import ActivityLog
from ..models.word_report import WordReport
from ..models.search_history import SearchHistory
from ..models.app_setting import AppSetting
from ..models.word_image_cache import WordImageCache
from ..schemas.word import WordOut, WordPendingOut, ActivityLogOut
from ..auth import require_admin
from ..models.user import User
from ..services.import_service import import_file, _gen_pinyin, _gen_pinyin_plain
from ..services.translate_service import (
    generate_english_meaning,
    batch_generate_metadata,
    batch_generate_english,
    generate_examples_for_word,
    generate_daily_words,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _to_int(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _log(db: Session, action: str, word_id: int = None, chinese: str = None, detail: str = None):
    db.add(ActivityLog(action=action, word_id=word_id, chinese=chinese, detail=detail))
    db.flush()


@router.get("/pending", response_model=list[WordPendingOut])
def list_pending(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(WordPending).order_by(WordPending.id).offset(skip).limit(limit).all()


class ApproveRequest(BaseModel):
    thai_meaning: Optional[str] = None
    pinyin: Optional[str] = None
    category: Optional[str] = None


@router.post("/pending/{pending_id}/approve", response_model=WordOut)
def approve_pending(
    pending_id: int,
    body: ApproveRequest = Body(default=ApproveRequest()),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    pending = db.query(WordPending).filter(WordPending.id == pending_id).first()
    if not pending:
        raise HTTPException(status_code=404, detail="ไม่พบคำที่รอ approve")

    thai = body.thai_meaning or pending.thai_meaning
    if not thai:
        raise HTTPException(status_code=400, detail="กรุณาใส่ความหมายภาษาไทยก่อน approve")

    english = pending.english_meaning

    # ใช้ค่าที่ admin แก้ไข หรือ fallback จาก pending
    pinyin_val = body.pinyin or pending.pinyin or ""
    category_val = body.category if body.category is not None else pending.category

    if pending.pinyin_plain:
        pinyin_plain = pending.pinyin_plain
    elif pending.chinese:
        pinyin_plain = ' '.join(lazy_pinyin(pending.chinese))
    else:
        pinyin_plain = pinyin_val

    word = Word(
        chinese=pending.chinese,
        pinyin=pinyin_val,
        pinyin_plain=pinyin_plain,
        thai_meaning=thai,
        english_meaning=english,
        category=category_val,
        status="verified",
        source=pending.source,
    )
    db.add(word)
    db.delete(pending)
    _log(db, "word_added", chinese=pending.chinese, detail=f"ความหมาย: {thai[:60]}")
    db.commit()
    db.refresh(word)

    return word


@router.delete("/pending/{pending_id}")
def reject_pending(
    pending_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    pending = db.query(WordPending).filter(WordPending.id == pending_id).first()
    if not pending:
        raise HTTPException(status_code=404, detail="ไม่พบคำที่รอ approve")
    db.delete(pending)
    db.commit()
    return {"ok": True}


@router.delete("/missed-searches/clear-singles")
def clear_single_missed(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """ลบ missed searches ที่มี count = 1 ทั้งหมด"""
    deleted = db.query(MissedSearch).filter(MissedSearch.count <= 1).delete()
    db.commit()
    return {"deleted": deleted}


@router.delete("/missed-searches/{missed_id}")
def delete_missed(
    missed_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    item = db.query(MissedSearch).filter(MissedSearch.id == missed_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ")
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.get("/missed-searches")
def list_missed(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return (
        db.query(MissedSearch)
        .order_by(MissedSearch.count.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/word-reports")
def list_word_reports(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    reports = (
        db.query(WordReport)
        .order_by(WordReport.created_at.desc())
        .limit(200)
        .all()
    )
    result = []
    for r in reports:
        word = db.query(Word).filter(Word.id == r.word_id).first()
        user = db.query(User).filter(User.id == r.user_id).first()
        result.append({
            "id": r.id,
            "word_id": r.word_id,
            "word_chinese": word.chinese if word else "?",
            "word_pinyin": word.pinyin if word else "",
            "user_id": r.user_id,
            "user_name": (user.display_name or user.identifier) if user else "?",
            "message": r.message,
            "created_at": r.created_at,
        })
    return result


@router.delete("/word-reports/{report_id}")
def delete_word_report(
    report_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    r = db.query(WordReport).filter(WordReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="ไม่พบรายงาน")
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/flagged-users")
def list_flagged_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    users = db.query(User).filter(User.report_flagged == True).all()
    result = []
    for u in users:
        history = (
            db.query(SearchHistory)
            .filter(SearchHistory.user_id == u.id)
            .order_by(SearchHistory.searched_at.desc())
            .limit(10)
            .all()
        )
        result.append({
            "id": u.id,
            "display_name": u.display_name or u.identifier,
            "identifier": u.identifier,
            "history": [
                {"query": h.query, "found": h.found, "searched_at": h.searched_at}
                for h in history
            ],
        })
    return result


@router.post("/users/{user_id}/unflag")
def unflag_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="ไม่พบ user")
    u.report_flagged = False
    db.commit()
    return {"ok": True}


@router.post("/import")
def import_words(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    result = import_file(db, tmp_path, source="prem_file")
    os.unlink(tmp_path)
    return result


class BatchMetadataRequest(BaseModel):
    word_ids: list[int]


@router.post("/batch-metadata")
def batch_metadata(
    body: BatchMetadataRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Generate english_meaning + category for pending words in batches."""
    pendings = db.query(WordPending).filter(WordPending.id.in_(body.word_ids)).all()
    if not pendings:
        raise HTTPException(status_code=404, detail="ไม่พบคำที่ระบุ")

    BATCH_SIZE = 20
    updated = 0

    for i in range(0, len(pendings), BATCH_SIZE):
        batch = pendings[i : i + BATCH_SIZE]
        payload = [
            {"id": w.id, "chinese": w.chinese, "thai": w.thai_meaning or ""}
            for w in batch
        ]
        results = batch_generate_metadata(payload)
        result_map = {r["id"]: r for r in results}

        for w in batch:
            meta = result_map.get(w.id)
            if meta:
                if meta.get("english"):
                    w.english_meaning = meta["english"]
                if meta.get("category"):
                    w.category = meta["category"]
                updated += 1

    db.commit()
    return {"updated": updated}


@router.post("/regenerate-english/{word_id}", response_model=WordOut)
def regenerate_english(
    word_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """หาคำแปลภาษาอังกฤษใหม่ให้คำศัพท์"""
    word = db.query(Word).filter(Word.id == word_id, Word.status == "verified").first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์ที่ verified")
    eng_result = generate_english_meaning(word.chinese, word.thai_meaning or "")
    if eng_result["english"]:
        word.english_meaning = eng_result["english"]
        if eng_result["thai_addition"] and eng_result["thai_addition"] not in (word.thai_meaning or ""):
            word.thai_meaning = (word.thai_meaning or "") + "\n" + eng_result["thai_addition"]
        db.commit()
        db.refresh(word)
    return word


@router.post("/generate-examples/{word_id}", response_model=WordOut)
def generate_examples(
    word_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Generate 3 example sentences for a verified word."""
    word = db.query(Word).filter(Word.id == word_id, Word.status == "verified").first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์ที่ verified")

    examples = generate_examples_for_word(word.chinese, word.pinyin, word.thai_meaning, word.category or "")

    # ลบ examples เดิมก่อน
    db.query(Example).filter(Example.word_id == word_id).delete()

    for idx, ex in enumerate(examples):
        db.add(Example(
            word_id=word_id,
            chinese=ex.get("chinese", ""),
            pinyin=ex.get("pinyin"),
            thai=ex.get("thai"),
            type=ex.get("type"),
            meaning_line=_to_int(ex.get("meaning_line")),
            sort_order=idx,
        ))

    _log(db, "example_added", word_id=word_id, chinese=word.chinese, detail=f"สร้าง {len(examples)} ประโยค")
    db.commit()
    db.refresh(word)
    return word


@router.get("/test-gemini")
def test_gemini(_: User = Depends(require_admin)):
    """ทดสอบว่า Gemini API ใช้งานได้ไหม"""
    from ..services.translate_service import _has_api_key, _model
    if not _has_api_key():
        return {"ok": False, "error": "GEMINI_API_KEY ไม่ได้ตั้งค่า หรือเป็น placeholder"}
    try:
        r = _model.generate_content("Reply with just the word: OK")
        return {"ok": True, "response": r.text.strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/gemini-quota")
def gemini_quota(_: User = Depends(require_admin)):
    """ดู Gemini API usage + OpenAI fallback stats + example queue status"""
    from ..services.translate_service import _rate_limiter, openai_status, gemini_blocked_status, jieba_stats
    from ..services.example_queue import example_queue
    return {
        **_rate_limiter.status(),
        "example_queue_pending": example_queue.size(),
        "gemini_blocked": gemini_blocked_status(),
        "openai": openai_status(),
        "jieba": jieba_stats(),
    }


@router.get("/gemini-models")
def list_gemini_models(_: User = Depends(require_admin)):
    """List models ที่ API key นี้รองรับ"""
    from ..services.translate_service import _client
    try:
        models = [m.name for m in _client.models.list()]
        return {"models": models}
    except Exception as e:
        return {"error": str(e)}


@router.get("/image-storage")
def image_storage(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """ดูพื้นที่ที่รูปใช้ใน DB"""
    from ..models.word_image_cache import WordImageCache

    LIMIT_MB = 600

    # นับทุก row (ทั้ง URL-only และ binary)
    total_row = db.execute(
        __import__("sqlalchemy").text(
            "SELECT COUNT(*) as total, "
            "COALESCE(SUM(octet_length(image_data)), 0) as binary_bytes "
            "FROM word_image_cache"
        )
    ).fetchone()

    binary_bytes = int(total_row.binary_bytes)
    image_count = int(total_row.total)
    used_mb = round(binary_bytes / 1024 / 1024, 2)

    # breakdown by source (รวม URL-only ด้วย)
    by_source_rows = db.execute(
        __import__("sqlalchemy").text(
            "SELECT COALESCE(image_source, 'unknown') as src, COUNT(*) as cnt, "
            "COALESCE(SUM(octet_length(image_data)), 0) as src_bytes "
            "FROM word_image_cache GROUP BY image_source"
        )
    ).fetchall()

    by_source = {r.src: {"count": r.cnt, "mb": round(r.src_bytes / 1024 / 1024, 2)} for r in by_source_rows}

    return {
        "image_count": image_count,
        "used_mb": used_mb,
        "limit_mb": LIMIT_MB,
        "used_percent": round(used_mb / LIMIT_MB * 100, 1),
        "by_source": by_source,
    }


@router.get("/examples-stats")
def examples_stats(
    min_length: int = 10,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """จำนวน verified words ที่มี/ไม่มี examples และมี examples สั้นเกินไป"""
    from sqlalchemy import func as sqlfunc
    total = db.query(Word).filter(Word.status == "verified").count()
    with_ex = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.in_(select(Example.word_id).distinct()))
        .count()
    )
    # words ที่มี example แต่ทุก example สั้นกว่า min_length (น่าจะเป็น example ที่ผิดพลาด)
    short_word_ids = (
        db.query(Example.word_id)
        .group_by(Example.word_id)
        .having(sqlfunc.max(sqlfunc.length(Example.chinese)) < min_length)
        .subquery()
    )
    with_short = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.in_(select(short_word_ids.c.word_id)))
        .count()
    )
    return {
        "total_verified": total,
        "with_examples": with_ex,
        "without_examples": total - with_ex,
        "with_short_examples": with_short,
        "min_length": min_length,
    }


@router.delete("/wipe-all-examples")
def wipe_all_examples(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """ลบ examples ทั้งหมดทุกคำ"""
    deleted = db.query(Example).delete()
    _log(db, "example_deleted", detail=f"ลบทั้งหมด {deleted} ประโยค")
    db.commit()
    return {"deleted": deleted}


@router.get("/english-stats")
def english_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    total = db.query(Word).filter(Word.status == "verified").count()
    with_en = db.query(Word).filter(Word.status == "verified", Word.english_meaning.isnot(None), Word.english_meaning != "").count()
    return {"total_verified": total, "with_english": with_en, "without_english": total - with_en}


@router.post("/bulk-generate-english")
def bulk_generate_english(
    limit: int = 500,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """สร้าง english_meaning ให้ verified words ที่ยังไม่มี (batch ทีละ limit คำ ใน 1 Gemini call)"""
    limit = min(max(limit, 1), 500)

    words = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(or_(Word.english_meaning.is_(None), Word.english_meaning == ""))
        .limit(limit)
        .all()
    )

    if not words:
        remaining = 0
        return {"done": 0, "errors": 0, "remaining": remaining}

    batch = [{"id": w.id, "chinese": w.chinese, "thai": w.thai_meaning or ""} for w in words]
    results = batch_generate_english(batch)

    done = 0
    errors = len(words) - len(results) if results else len(words)
    for item in results:
        word = next((w for w in words if w.id == item.get("id")), None)
        if word and item.get("english"):
            word.english_meaning = item["english"]
            thai_addition = str(item.get("thai_addition", "")).strip()
            if thai_addition and thai_addition not in (word.thai_meaning or ""):
                word.thai_meaning = (word.thai_meaning or "") + "\n" + thai_addition
            done += 1
    if done > 0:
        _log(db, "bulk_english", detail=f"อัปเดต {done} คำ")
    db.commit()

    remaining = db.query(Word).filter(
        Word.status == "verified",
        or_(Word.english_meaning.is_(None), Word.english_meaning == ""),
    ).count()
    return {"done": done, "errors": errors, "remaining": remaining}


def _single_english_base_query(db, category: str = None):
    """คำที่มี english_meaning คำเดียว (ไม่มี comma) — filter by category ได้"""
    q = db.query(Word).filter(
        Word.status == "verified",
        Word.english_meaning.isnot(None),
        Word.english_meaning != "",
        Word.english_meaning.notlike("%,%"),
    )
    if category == "__none__":
        q = q.filter(or_(Word.category.is_(None), Word.category == ""))
    elif category:
        q = q.filter(Word.category == category)
    return q


@router.get("/single-english-stats")
def single_english_stats(
    category: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return {"count": _single_english_base_query(db, category).count()}


@router.post("/bulk-regen-single-english")
def bulk_regen_single_english(
    limit: int = 50,
    category: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Regen english สำหรับคำที่มีแค่คำเดียว (ไม่มี comma) ให้ครอบคลุมทุกความหมาย"""
    limit = min(max(limit, 1), 100)
    words = _single_english_base_query(db, category).limit(limit).all()

    if not words:
        return {"done": 0, "errors": 0, "remaining": 0}

    batch = [{"id": w.id, "chinese": w.chinese, "thai": w.thai_meaning or ""} for w in words]
    results = batch_generate_english(batch)

    done = 0
    skipped = 0  # Gemini คืนคำเดียวอีก ไม่อัปเดต
    errors = len(words) - len(results) if results else len(words)
    for item in results:
        word = next((w for w in words if w.id == item.get("id")), None)
        if not word:
            continue
        new_eng = item.get("english", "").strip()
        if not new_eng:
            errors += 1
            continue
        if "," not in new_eng:
            # ยังคืนคำเดียวอยู่ — ไม่นับว่าแก้แล้ว ข้ามไป
            skipped += 1
            continue
        word.english_meaning = new_eng
        thai_addition = str(item.get("thai_addition", "")).strip()
        if thai_addition and thai_addition not in (word.thai_meaning or ""):
            word.thai_meaning = (word.thai_meaning or "") + "\n" + thai_addition
        done += 1

    if done > 0:
        _log(db, "regen_single_english", detail=f"อัปเดต {done} คำ (single→multi)")
    db.commit()

    remaining = _single_english_base_query(db, category).count()
    return {"done": done, "skipped": skipped, "errors": errors, "remaining": remaining}


@router.post("/bulk-generate-examples")
def bulk_generate_examples(
    limit: int = 30,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """สร้าง examples ให้ verified words ที่ยังไม่มี (ทีละ limit คำ)"""
    limit = min(max(limit, 1), 100)

    words = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.notin_(select(Example.word_id).distinct()))
        .limit(limit)
        .all()
    )

    done = 0
    errors = 0
    last_error = None
    for word in words:
        try:
            examples = generate_examples_for_word(
                word.chinese, word.pinyin or "", word.thai_meaning or "", word.category or ""
            )
            if not examples:
                errors += 1
                last_error = f"{word.chinese}: Gemini returned empty"
            else:
                for idx, ex in enumerate(examples):
                    db.add(Example(
                        word_id=word.id,
                        chinese=ex.get("chinese", ""),
                        pinyin=ex.get("pinyin"),
                        thai=ex.get("thai"),
                        type=ex.get("type"),
                        meaning_line=_to_int(ex.get("meaning_line")),
                        sort_order=idx,
                    ))
                db.commit()
                done += 1
        except Exception as e:
            errors += 1
            last_error = str(e)
        time.sleep(0.3)

    if done > 0:
        _log(db, "bulk_examples", detail=f"สร้างตัวอย่าง {done} คำ")
        db.commit()

    remaining = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.notin_(select(Example.word_id).distinct()))
        .count()
    )
    return {"done": done, "errors": errors, "remaining": remaining, "last_error": last_error}


@router.post("/bulk-queue-examples")
def bulk_queue_examples(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """โยนคำที่ยังไม่มี examples ทั้งหมดเข้า background queue แล้ว return ทันที"""
    from ..services.example_queue import example_queue

    word_ids = [
        row[0]
        for row in db.query(Word.id)
        .filter(Word.status == "verified")
        .filter(Word.id.notin_(select(Example.word_id).distinct()))
        .all()
    ]

    example_queue.enqueue_many(word_ids)
    return {"queued": len(word_ids), "queue_size": example_queue.size()}


@router.post("/bulk-regen-short-examples")
def bulk_regen_short_examples(
    limit: int = 30,
    min_length: int = 10,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """ลบและ gen ใหม่สำหรับคำที่มี examples แต่สั้นเกินไป (max chinese length < min_length)"""
    from sqlalchemy import func as sqlfunc
    limit = min(max(limit, 1), 100)

    short_word_ids = (
        db.query(Example.word_id)
        .group_by(Example.word_id)
        .having(sqlfunc.max(sqlfunc.length(Example.chinese)) < min_length)
        .subquery()
    )
    words = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.in_(select(short_word_ids.c.word_id)))
        .limit(limit)
        .all()
    )

    done = 0
    errors = 0
    last_error = None
    for word in words:
        try:
            examples = generate_examples_for_word(
                word.chinese, word.pinyin or "", word.thai_meaning or "", word.category or ""
            )
            if not examples:
                errors += 1
                last_error = f"{word.chinese}: Gemini returned empty"
            else:
                db.query(Example).filter(Example.word_id == word.id).delete()
                for idx, ex in enumerate(examples):
                    db.add(Example(
                        word_id=word.id,
                        chinese=ex.get("chinese", ""),
                        pinyin=ex.get("pinyin"),
                        thai=ex.get("thai"),
                        type=ex.get("type"),
                        meaning_line=_to_int(ex.get("meaning_line")),
                        sort_order=idx,
                    ))
                db.commit()
                done += 1
        except Exception as e:
            errors += 1
            last_error = str(e)
        time.sleep(0.3)

    if done > 0:
        _log(db, "bulk_examples", detail=f"regen short examples {done} คำ")
        db.commit()

    # นับที่เหลือ
    remaining_short_ids = (
        db.query(Example.word_id)
        .group_by(Example.word_id)
        .having(sqlfunc.max(sqlfunc.length(Example.chinese)) < min_length)
        .subquery()
    )
    remaining = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.in_(select(remaining_short_ids.c.word_id)))
        .count()
    )
    return {"done": done, "errors": errors, "remaining": remaining, "last_error": last_error}


@router.post("/regen-examples-by-category")
def regen_examples_by_category(
    category: str,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """ลบและ gen ตัวอย่างใหม่สำหรับคำใน category ที่กำหนด (ใช้ logic ใหม่)"""
    limit = min(max(limit, 1), 50)
    offset = max(offset, 0)

    words = (
        db.query(Word)
        .filter(Word.status == "verified", Word.category == category)
        .order_by(Word.id)
        .offset(offset)
        .limit(limit)
        .all()
    )

    if not words:
        return {"done": 0, "errors": 0, "total_in_category": 0, "next_offset": offset, "message": f"ไม่พบคำใน category '{category}'"}

    done = 0
    errors = 0
    last_error = None
    for word in words:
        try:
            examples = generate_examples_for_word(
                word.chinese, word.pinyin or "", word.thai_meaning or "", word.category or ""
            )
            if not examples:
                errors += 1
                last_error = f"{word.chinese}: Gemini returned empty"
            else:
                db.query(Example).filter(Example.word_id == word.id).delete()
                for idx, ex in enumerate(examples):
                    db.add(Example(
                        word_id=word.id,
                        chinese=ex.get("chinese", ""),
                        pinyin=ex.get("pinyin"),
                        thai=ex.get("thai"),
                        type=ex.get("type"),
                        meaning_line=_to_int(ex.get("meaning_line")),
                        sort_order=idx,
                    ))
                db.commit()
                done += 1
        except Exception as e:
            errors += 1
            last_error = str(e)
        time.sleep(0.3)

    if done > 0:
        _log(db, "regen_examples", detail=f"regen ตัวอย่าง {done} คำ category={category}")
        db.commit()

    total_in_cat = db.query(Word).filter(Word.status == "verified", Word.category == category).count()
    return {
        "done": done,
        "errors": errors,
        "total_in_category": total_in_cat,
        "next_offset": offset + len(words),
        "last_error": last_error,
    }


class GenerateDailyRequest(BaseModel):
    count: int = 100
    category: Optional[str] = None
    keyword: Optional[str] = None


@router.post("/generate-daily-words")
def generate_daily(
    body: GenerateDailyRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Ask Gemini to generate N Chinese words, auto-gen pinyin+category, insert to words_pending."""
    count = min(max(body.count, 10), 200)

    existing = {w[0] for w in db.query(Word.chinese).all()}
    existing |= {w[0] for w in db.query(WordPending.chinese).all()}

    try:
        suggestions = generate_daily_words(count, existing, category=body.category, keyword=body.keyword)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    inserted = 0
    for item in suggestions:
        chinese = item["chinese"]
        if not chinese or chinese in existing:
            continue
        db.add(WordPending(
            chinese=chinese,
            pinyin=_gen_pinyin(chinese),
            pinyin_plain=_gen_pinyin_plain(chinese),
            category=item.get("category") or None,
            source="ai_daily",
        ))
        existing.add(chinese)
        inserted += 1

    db.commit()
    return {"inserted": inserted, "requested": count}


@router.get("/fix-long-english")
@router.post("/fix-long-english")
def fix_long_english(
    max_len: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Re-generate english_meaning ที่ยาวเกิน max_len (น่าจะเป็น Gemini thinking หลุดมา)"""
    bad_words = (
        db.query(Word)
        .filter(Word.english_meaning.isnot(None))
        .filter(Word.english_meaning != "")
        .all()
    )
    bad_words = [w for w in bad_words if len(w.english_meaning) > max_len]

    if not bad_words:
        return {"found": 0, "fixed": 0, "failed": 0}

    fixed = 0
    failed = 0
    for w in bad_words:
        eng_result = generate_english_meaning(w.chinese, w.thai_meaning or "")
        new_eng = eng_result["english"]
        if new_eng and len(new_eng) <= max_len:
            w.english_meaning = new_eng
            thai_addition = eng_result["thai_addition"]
            if thai_addition and thai_addition not in (w.thai_meaning or ""):
                w.thai_meaning = (w.thai_meaning or "") + "\n" + thai_addition
            fixed += 1
        else:
            failed += 1

    if fixed > 0:
        _log(db, "fix_long_english", detail=f"แก้ไข {fixed} คำ")
        db.commit()

    return {"found": len(bad_words), "fixed": fixed, "failed": failed}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.query(AppSetting).all()
    result = {}
    for row in rows:
        try:
            result[row.key] = json.loads(row.value)
        except Exception:
            result[row.key] = row.value
    return result


@router.put("/settings")
def update_settings(data: dict = Body(...), db: Session = Depends(get_db), _: User = Depends(require_admin)):
    for key, value in data.items():
        serialized = json.dumps(value, ensure_ascii=False)
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row:
            row.value = serialized
        else:
            db.add(AppSetting(key=key, value=serialized))
    db.commit()
    return {"ok": True}


@router.delete("/image-cache")
def delete_image_cache(category: str, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """ลบ cache รูปภาพของคำในหมวดที่ระบุ"""
    word_ids = db.query(Word.id).filter(Word.category == category).all()
    word_ids = [w[0] for w in word_ids]
    deleted = db.query(WordImageCache).filter(WordImageCache.word_id.in_(word_ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted, "category": category}


@router.delete("/image-cache/null")
def delete_null_image_cache(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """ลบ cache entries ที่มี image_url=null (ทำให้ระบบ retry หารูปใหม่)"""
    deleted = (
        db.query(WordImageCache)
        .filter(WordImageCache.image_url.is_(None), WordImageCache.image_data.is_(None))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": deleted}


@router.delete("/image-cache/all")
def delete_all_image_cache(exclude_categories: str = "", db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """ลบ cache รูปทั้งหมด ยกเว้น category ที่ระบุ (comma-separated)"""
    excluded = [c.strip() for c in exclude_categories.split(",") if c.strip()]
    q = db.query(WordImageCache)
    if excluded:
        keep_ids = db.query(Word.id).filter(Word.category.in_(excluded)).all()
        keep_ids = [w[0] for w in keep_ids]
        if keep_ids:
            q = q.filter(~WordImageCache.word_id.in_(keep_ids))
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted, "excluded_categories": excluded}


@router.get("/activity-log", response_model=list[ActivityLogOut])
def activity_log(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """ประวัติการเปลี่ยนแปลงคำศัพท์ล่าสุด"""
    limit = min(max(limit, 1), 200)
    return (
        db.query(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )


class ImportWordsRequest(BaseModel):
    words: str  # Chinese words one per line (or comma-separated)


@router.post("/import-words")
def import_words_bulk(
    body: ImportWordsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Import Chinese words (one per line) into words_pending with source='import'."""
    existing = {w[0] for w in db.query(Word.chinese).all()}
    existing |= {w[0] for w in db.query(WordPending.chinese).all()}

    # รองรับทั้ง newline และ comma
    raw = body.words.replace(',', '\n')
    lines = [line.strip() for line in raw.splitlines() if line.strip()]

    inserted = 0
    skipped = 0
    for chinese in lines:
        if not chinese or chinese in existing:
            skipped += 1
            continue
        db.add(WordPending(
            chinese=chinese,
            pinyin=_gen_pinyin(chinese),
            pinyin_plain=_gen_pinyin_plain(chinese),
            source="import",
        ))
        existing.add(chinese)
        inserted += 1

    db.commit()
    return {"inserted": inserted, "skipped": skipped}
