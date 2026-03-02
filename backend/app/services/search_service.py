from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from ..models.word import Word
from ..models.missed_search import MissedSearch
from ..schemas.search import SearchResult


def _mark_multiple_readings(db: Session, words: list) -> None:
    """Set has_multiple_readings=True on Word instances that share chinese with another entry."""
    if not words:
        return
    chinese_set = {w.chinese for w in words}
    multi = {
        row[0]
        for row in db.query(Word.chinese)
        .filter(Word.status == "verified", Word.chinese.in_(chinese_set))
        .group_by(Word.chinese)
        .having(func.count(Word.id) > 1)
        .all()
    }
    for w in words:
        w.has_multiple_readings = w.chinese in multi


def detect_language(query: str) -> str:
    """Detect if query is chinese, english, or thai."""
    if any('\u4e00' <= c <= '\u9fff' for c in query):
        return 'chinese'
    if all(ord(c) < 128 for c in query.replace(' ', '')):
        return 'english'
    return 'thai'


def search_words(db: Session, query: str) -> SearchResult:
    q = query.strip()
    if not q:
        return SearchResult(query=q, found=False)

    lang = detect_language(q)

    # English query → Gemini แปลก่อน แล้วค้นใน DB
    if lang == 'english':
        return _search_english(db, q)

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

    all_results = prefix_results + inner_results
    _mark_multiple_readings(db, all_results)

    return SearchResult(
        query=q,
        prefix_group=prefix_results,
        inner_group=inner_results,
        total=total,
        found=found,
    )


def _search_english(db: Session, query: str) -> SearchResult:
    """English query: ask Gemini for Chinese candidates, then lookup in DB."""
    from ..services.translate_service import search_by_english

    suggestions = search_by_english(query)
    if not suggestions:
        return SearchResult(query=query, found=False)

    # ค้น DB ด้วย chinese จาก Gemini suggestions
    chinese_candidates = [s["chinese"] for s in suggestions if s.get("chinese")]
    if not chinese_candidates:
        return SearchResult(query=query, found=False)

    results = (
        db.query(Word)
        .filter(
            Word.status == "verified",
            Word.chinese.in_(chinese_candidates),
        )
        .order_by(Word.char_count.asc())
        .all()
    )

    # คำที่ Gemini แนะนำแต่ยังไม่อยู่ใน DB → ใส่ inner_group เป็น placeholder ไม่ได้
    # ดังนั้นแค่คืนสิ่งที่เจอใน DB เท่านั้น
    found = len(results) > 0
    _mark_multiple_readings(db, results)
    return SearchResult(
        query=query,
        prefix_group=results,
        inner_group=[],
        total=len(results),
        found=found,
    )


def validate_and_record_missed(db: Session, query: str) -> bool:
    """ตรวจว่า query เป็นคำจริง → ถ้าใช่ บันทึก missed_search"""
    from ..services.translate_service import validate_word_exists
    lang = detect_language(query)
    if validate_word_exists(query, lang):
        _record_missed(db, query)
        return True
    return False


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
