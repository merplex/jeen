from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.flashcard import Flashcard
from ..models.word import Word
from ..models.subscription import UserSubscription
from ..schemas.flashcard import FlashcardOut
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/flashcards", tags=["flashcards"])

PREMIUM_DECKS = {2, 3}


def _has_subscription(user_id: int, db: Session) -> bool:
    from datetime import datetime
    sub = (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user_id,
            UserSubscription.status == "active",
        )
        .first()
    )
    if not sub:
        return False
    if sub.expires_at and sub.expires_at < datetime.utcnow():
        return False
    return True


@router.get("", response_model=list[FlashcardOut])
def list_flashcards(
    deck: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    q = db.query(Flashcard).filter(Flashcard.user_id == current_user.id)
    if deck is not None:
        q = q.filter(Flashcard.deck == deck)
    return q.order_by(Flashcard.added_at.desc()).all()


@router.get("/word/{word_id}")
def get_word_decks(
    word_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """คืน list ของ deck ที่คำนี้อยู่ เช่น [1, 3]"""
    rows = (
        db.query(Flashcard.deck)
        .filter(Flashcard.user_id == current_user.id, Flashcard.word_id == word_id)
        .all()
    )
    return {"decks": [r.deck for r in rows]}


@router.get("/stats")
def flashcard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """คืน count ของแต่ละ deck"""
    result = {}
    for deck in [1, 2, 3]:
        count = (
            db.query(Flashcard)
            .filter(Flashcard.user_id == current_user.id, Flashcard.deck == deck)
            .count()
        )
        result[str(deck)] = count
    return result


@router.post("/{word_id}", response_model=FlashcardOut)
def add_flashcard(
    word_id: int,
    deck: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    if deck not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="deck ต้องเป็น 1, 2 หรือ 3")
    if deck in PREMIUM_DECKS and not current_user.is_admin and not _has_subscription(current_user.id, db):
        raise HTTPException(status_code=403, detail="การ์ดชุด 2 และ 3 สำหรับสมาชิกพรีเมียมเท่านั้น")

    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")

    existing = db.query(Flashcard).filter(
        Flashcard.user_id == current_user.id,
        Flashcard.word_id == word_id,
        Flashcard.deck == deck,
    ).first()
    if existing:
        return existing

    fc = Flashcard(user_id=current_user.id, word_id=word_id, deck=deck)
    db.add(fc)
    db.commit()
    db.refresh(fc)
    return fc


@router.delete("/{word_id}")
def remove_flashcard(
    word_id: int,
    deck: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    fc = db.query(Flashcard).filter(
        Flashcard.user_id == current_user.id,
        Flashcard.word_id == word_id,
        Flashcard.deck == deck,
    ).first()
    if not fc:
        raise HTTPException(status_code=404, detail="ไม่พบ flashcard")
    db.delete(fc)
    db.commit()
    return {"ok": True}
