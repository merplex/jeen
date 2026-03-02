from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..schemas.word import WordOut, WordCreate, WordUpdate
from ..auth import require_admin

router = APIRouter(prefix="/words", tags=["words"])


@router.get("/{word_id}", response_model=WordOut)
def get_word(word_id: int, db: Session = Depends(get_db)):
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
    word = Word(**data.model_dump(), status="verified")
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
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(word, field, value)
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
