from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.search_service import search_words, validate_and_record_missed
from ..services.translate_service import search_by_english
from ..schemas.search import SearchResult
from ..auth import get_current_user
from ..models.user import User
from ..models.search_history import SearchHistory
from typing import Optional

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchResult)
def search(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    result = search_words(db, q)

    # บันทึก history ถ้า login อยู่
    if current_user:
        first_word_id = result.prefix_group[0].id if result.prefix_group else (
            result.inner_group[0].id if result.inner_group else None
        )
        history = SearchHistory(
            user_id=current_user.id,
            query=q,
            result_word_id=first_word_id,
            found=result.found,
        )
        db.add(history)
        db.commit()

        # trim เหลือ 100 คำล่าสุด
        old_records = (
            db.query(SearchHistory)
            .filter(SearchHistory.user_id == current_user.id)
            .order_by(SearchHistory.searched_at.desc())
            .offset(100)
            .all()
        )
        for r in old_records:
            db.delete(r)
        db.commit()

    return result


@router.get("/english")
def search_english(q: str = Query(..., min_length=1)):
    results = search_by_english(q)
    return {"query": q, "results": results}


@router.post("/report-missed")
def report_missed(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """รับรายงาน missed search จาก frontend (หลัง debounce 10s หรือกด Enter)
    ตรวจกับ Gemini ก่อนว่าเป็นคำจริง แล้วจึงบันทึก"""
    recorded = validate_and_record_missed(db, q)
    return {"recorded": recorded, "query": q}
