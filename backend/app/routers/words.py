from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..models.activity_log import ActivityLog
from ..schemas.word import WordOut, WordCreate, WordUpdate
from ..auth import require_admin, require_user
from ..services.import_service import _gen_pinyin, _gen_pinyin_plain

router = APIRouter(prefix="/words", tags=["words"])


@router.get("/{word_id}", response_model=WordOut)
def get_word(
    word_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_user),
):
    word = db.query(Word).filter(Word.id == word_id, Word.status == "verified").first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    return word


@router.post("", response_model=WordOut)
def create_word(
    data: WordCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    existing = db.query(Word).filter(Word.chinese == data.chinese).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"มีคำว่า '{data.chinese}' อยู่แล้ว (ID: {existing.id})")

    d = data.model_dump()
    if not d.get("pinyin"):
        d["pinyin"] = _gen_pinyin(data.chinese)
    if not d.get("pinyin_plain"):
        d["pinyin_plain"] = _gen_pinyin_plain(data.chinese)

    db.add(ActivityLog(action="word_added", chinese=data.chinese, detail=f"ความหมาย: {data.thai_meaning[:60]}"))
    word = Word(**d, status="verified")
    db.add(word)
    db.commit()
    db.refresh(word)
    return word


@router.put("/{word_id}", response_model=WordOut)
def update_word(
    word_id: int,
    data: WordUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    changed_fields = []
    for field, value in data.model_dump(exclude_none=True).items():
        if getattr(word, field) != value:
            changed_fields.append(field)
        setattr(word, field, value)
    word.admin_edited = True
    detail = f"แก้ไข: {', '.join(changed_fields)}" if changed_fields else "แก้ไขข้อมูล"
    db.add(ActivityLog(action="word_edited", word_id=word.id, chinese=word.chinese, detail=detail))
    db.commit()
    db.refresh(word)
    return word


@router.delete("/{word_id}")
def delete_word(
    word_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    db.delete(word)
    db.commit()
    return {"ok": True}
