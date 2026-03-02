from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..models.search_history import SearchHistory
from ..schemas.user import UserLogin, UserOut, Token
from ..schemas.word import WordOut
from ..auth import create_token, require_user
from ..config import settings

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.identifier == data.identifier).first()
    is_admin = data.identifier in settings.admin_list
    if not user:
        user = User(
            identifier=data.identifier,
            id_type=data.id_type,
            display_name=data.display_name,
            is_admin=is_admin,
        )
        db.add(user)
    else:
        # sync is_admin ทุกครั้ง เผื่อ ADMIN_IDENTIFIERS เพิ่ง update
        user.is_admin = is_admin
    db.commit()
    db.refresh(user)
    token = create_token(user.id)
    return Token(access_token=token, user=user)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(require_user)):
    return current_user


@router.get("/me/history")
def get_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    records = (
        db.query(SearchHistory)
        .filter(SearchHistory.user_id == current_user.id)
        .order_by(SearchHistory.searched_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": r.id,
            "query": r.query,
            "found": r.found,
            "searched_at": r.searched_at,
            "result_word_id": r.result_word_id,
        }
        for r in records
    ]


@router.delete("/me/history/{history_id}")
def delete_history(
    history_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    record = (
        db.query(SearchHistory)
        .filter(SearchHistory.id == history_id, SearchHistory.user_id == current_user.id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=404, detail="ไม่พบประวัติ")
    db.delete(record)
    db.commit()
    return {"ok": True}
