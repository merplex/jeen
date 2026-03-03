from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db
from ..services.search_service import search_words, validate_and_record_missed
from ..services.translate_service import search_by_english
from ..schemas.search import SearchResult
from ..auth import get_current_user, require_user
from ..models.user import User
from ..models.search_history import SearchHistory
from typing import Optional

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchResult)
def search(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    return search_words(db, q)


@router.post("/record-history")
def record_history(
    q: str = Query(..., min_length=1),
    word_id: Optional[int] = Query(None),
    found: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """บันทึกประวัติค้นหา — เรียกเฉพาะเมื่อ user หยุดพิมพ์ หรือกด Enter"""
    db.add(SearchHistory(
        user_id=current_user.id,
        query=q,
        result_word_id=word_id,
        found=found,
    ))
    db.commit()

    # trim เหลือ 100 คำล่าสุด
    old = (
        db.query(SearchHistory)
        .filter(SearchHistory.user_id == current_user.id)
        .order_by(SearchHistory.searched_at.desc())
        .offset(100)
        .all()
    )
    for r in old:
        db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/english")
def search_english(q: str = Query(..., min_length=1)):
    results = search_by_english(q)
    return {"query": q, "results": results}


@router.post("/report-missed")
def report_missed(
    q: str = Query(..., min_length=1),
    skip_validate: bool = Query(False),
    db: Session = Depends(get_db),
):
    """รับรายงาน missed search จาก frontend
    - skip_validate=False (default): ตรวจกับ Gemini ก่อนว่าเป็นคำจริง (กรณีพิมพ์เอง)
    - skip_validate=True: บันทึกตรง ไม่ validate (กรณี long-press เลือกจากข้อความจริง)
    """
    if skip_validate:
        from ..services.search_service import _record_missed
        _record_missed(db, q)
        return {"recorded": True, "query": q}
    recorded = validate_and_record_missed(db, q)
    return {"recorded": recorded, "query": q}
