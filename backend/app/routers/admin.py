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
    if not english and pending.chinese and thai:
        english = generate_english_meaning(pending.chinese, thai)

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

    # Auto-generate examples (best effort — ไม่ block approval ถ้า Gemini ล้มเหลว)
    try:
        examples = generate_examples_for_word(word.chinese, word.pinyin, word.thai_meaning)
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
        db.refresh(word)
    except Exception:
        pass

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

    examples = generate_examples_for_word(word.chinese, word.pinyin, word.thai_meaning)

    # ลบ examples เดิมก่อน
    db.query(Example).filter(Example.word_id == word_id).delete()

    for idx, ex in enumerate(examples):
        db.add(Example(
            word_id=word_id,
            chinese=ex.get("chinese", ""),
            pinyin=ex.get("pinyin"),
            thai=ex.get("thai"),
            type=ex.get("type"),
            meaning_line=ex.get("meaning_line", 0),
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


@router.get("/examples-stats")
def examples_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """จำนวน verified words ที่มี/ไม่มี examples"""
    total = db.query(Word).filter(Word.status == "verified").count()
    with_ex = (
        db.query(Word)
        .filter(Word.status == "verified")
        .filter(Word.id.in_(select(Example.word_id).distinct()))
        .count()
    )
    return {
        "total_verified": total,
        "with_examples": with_ex,
        "without_examples": total - with_ex,
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
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """สร้าง english_meaning ให้ verified words ที่ยังไม่มี (batch ทีละ limit คำ ใน 1 Gemini call)"""
    limit = min(max(limit, 1), 100)

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
            done += 1
    if done > 0:
        _log(db, "bulk_english", detail=f"อัปเดต {done} คำ")
    db.commit()

    remaining = db.query(Word).filter(
        Word.status == "verified",
        or_(Word.english_meaning.is_(None), Word.english_meaning == ""),
    ).count()
    return {"done": done, "errors": errors, "remaining": remaining}


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
                word.chinese, word.pinyin or "", word.thai_meaning or ""
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
                        meaning_line=ex.get("meaning_line", 0),
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


class GenerateDailyRequest(BaseModel):
    count: int = 100
    category: Optional[str] = None


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
        suggestions = generate_daily_words(count, existing, category=body.category)
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
