from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.flashcard import Flashcard
from ..models.word import Word
from ..schemas.flashcard import FlashcardOut
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


@router.get("", response_model=list[FlashcardOut])
def list_flashcards(db: Session = Depends(get_db), current_user: User = Depends(require_user)):
    return (
        db.query(Flashcard)
        .filter(Flashcard.user_id == current_user.id)
        .order_by(Flashcard.added_at.desc())
        .all()
    )


@router.post("/{word_id}", response_model=FlashcardOut)
def add_flashcard(
    word_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    existing = db.query(Flashcard).filter(
        Flashcard.user_id == current_user.id, Flashcard.word_id == word_id
    ).first()
    if existing:
        return existing
    fc = Flashcard(user_id=current_user.id, word_id=word_id)
    db.add(fc)
    db.commit()
    db.refresh(fc)
    return fc


@router.delete("/{word_id}")
def remove_flashcard(
    word_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    fc = db.query(Flashcard).filter(
        Flashcard.user_id == current_user.id, Flashcard.word_id == word_id
    ).first()
    if not fc:
        raise HTTPException(status_code=404, detail="ไม่พบ flashcard")
    db.delete(fc)
    db.commit()
    return {"ok": True}
