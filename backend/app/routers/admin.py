from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
import shutil, tempfile, os
from ..database import get_db
from ..models.word import Word, WordPending
from ..models.missed_search import MissedSearch
from ..schemas.word import WordOut, WordPendingOut
from ..auth import require_admin
from ..models.user import User
from ..services.import_service import import_file
from ..services.translate_service import generate_english_meaning

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/pending", response_model=list[WordPendingOut])
def list_pending(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(WordPending).order_by(WordPending.id).offset(skip).limit(limit).all()


@router.post("/pending/{pending_id}/approve", response_model=WordOut)
def approve_pending(
    pending_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    pending = db.query(WordPending).filter(WordPending.id == pending_id).first()
    if not pending:
        raise HTTPException(status_code=404, detail="ไม่พบคำที่รอ approve")

    # auto-generate english ถ้ายังไม่มี
    english = pending.english_meaning
    if not english and pending.chinese and pending.thai_meaning:
        english = generate_english_meaning(pending.chinese, pending.thai_meaning)

    word = Word(
        chinese=pending.chinese,
        pinyin=pending.pinyin or "",
        pinyin_plain=pending.pinyin,
        thai_meaning=pending.thai_meaning or "",
        english_meaning=english,
        category=pending.category,
        status="verified",
    )
    db.add(word)
    db.delete(pending)
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
