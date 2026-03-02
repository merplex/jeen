from sqlalchemy.orm import Session
from sqlalchemy import or_
from ..models.word import Word
from ..models.missed_search import MissedSearch
from ..schemas.search import SearchResult


def search_words(db: Session, query: str) -> SearchResult:
    q = query.strip()
    if not q:
        return SearchResult(query=q, found=False)

    # STEP 1: PREFIX — chinese / pinyin_plain / thai_meaning ขึ้นต้นด้วย query
    prefix_results = (
        db.query(Word)
        .filter(
            Word.status == "verified",
            or_(
                Word.chinese.like(f"{q}%"),
                Word.pinyin_plain.ilike(f"{q}%"),
                Word.thai_meaning.like(f"{q}%"),
            ),
        )
        .order_by(Word.char_count.asc())
        .all()
    )

    prefix_ids = {w.id for w in prefix_results}

    # STEP 2: INNER — มี query อยู่ข้างใน แต่ไม่อยู่ใน prefix แล้ว
    inner_results = (
        db.query(Word)
        .filter(
            Word.status == "verified",
            Word.id.notin_(prefix_ids),
            or_(
                Word.chinese.like(f"%{q}%"),
                Word.pinyin_plain.ilike(f"%{q}%"),
                Word.thai_meaning.like(f"%{q}%"),
            ),
        )
        .order_by(Word.char_count.asc())
        .all()
    )

    total = len(prefix_results) + len(inner_results)
    found = total > 0

    # STEP 3: ไม่เจอ → บันทึก missed_searches
    if not found:
        _record_missed(db, q)

    return SearchResult(
        query=q,
        prefix_group=prefix_results,
        inner_group=inner_results,
        total=total,
        found=found,
    )


def _record_missed(db: Session, query: str):
    missed = db.query(MissedSearch).filter(MissedSearch.query == query).first()
    if missed:
        missed.count += 1
        from sqlalchemy import func
        missed.last_searched_at = func.now()
    else:
        missed = MissedSearch(query=query, count=1)
        db.add(missed)
    db.commit()
