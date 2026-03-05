from collections import Counter
from sqlalchemy.orm import Session
from sqlalchemy import or_
from ..models.word import Word
from ..models.missed_search import MissedSearch
from ..schemas.search import SearchResult


def _mark_multiple_readings(words: list) -> None:
    """Mark words whose chinese character appears more than once in the result set."""
    counts = Counter(w.chinese for w in words)
    for w in words:
        w.has_multiple_readings = counts[w.chinese] > 1


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

    if lang == 'english':
        # 1) english_meaning column (exact brand/word match — Nike, exit, money, ...)
        eng_result = _search_by_english_meaning(db, q)
        # 2) pinyin (chukou, nihao, ...)
        pin_result = _search_by_pinyin(db, q)

        # merge: english_meaning prefix first, then pinyin results not already included
        if eng_result.found or pin_result.found:
            eng_ids = {w.id for w in (eng_result.prefix_group + eng_result.inner_group)}
            extra_prefix = [w for w in pin_result.prefix_group if w.id not in eng_ids]
            extra_inner = [w for w in pin_result.inner_group if w.id not in eng_ids]
            prefix = eng_result.prefix_group + extra_prefix
            inner = eng_result.inner_group + extra_inner
            total = len(prefix) + len(inner)
            _mark_multiple_readings(prefix + inner)
            return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=True)

        # 3) Gemini fallback
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
    _mark_multiple_readings(all_results)

    return SearchResult(
        query=q,
        prefix_group=prefix_results,
        inner_group=inner_results,
        total=total,
        found=found,
    )


def _search_by_pinyin(db: Session, q: str) -> SearchResult:
    """ค้นด้วย pinyin_plain รองรับทั้ง 'cong' และ 'ni hao' และ 'niha' (ไม่มีวรรค)"""
    from sqlalchemy import func as sqlfunc
    # strip spaces ทั้งฝั่ง query และ pinyin_plain ก่อน compare
    # → 'chukou' จับคู่กับ 'chu kou' ได้
    q_ns = q.replace(' ', '')
    pinyin_ns = sqlfunc.replace(Word.pinyin_plain, ' ', '')

    prefix = (
        db.query(Word)
        .filter(Word.status == "verified", pinyin_ns.ilike(f"{q_ns}%"))
        .order_by(Word.char_count.asc())
        .all()
    )
    prefix_ids = {w.id for w in prefix}
    inner = (
        db.query(Word)
        .filter(
            Word.status == "verified",
            Word.id.notin_(prefix_ids),
            pinyin_ns.ilike(f"%{q_ns}%"),
        )
        .order_by(Word.char_count.asc())
        .all()
    )
    total = len(prefix) + len(inner)
    _mark_multiple_readings(prefix + inner)
    return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=total > 0)


def _search_by_english_meaning(db: Session, q: str) -> SearchResult:
    """ค้น english_meaning column ใน DB โดยตรง — ไม่ต้องเรียก Gemini"""
    prefix = (
        db.query(Word)
        .filter(Word.status == "verified", Word.english_meaning.ilike(f"{q}%"))
        .order_by(Word.char_count.asc())
        .all()
    )
    prefix_ids = {w.id for w in prefix}
    inner = (
        db.query(Word)
        .filter(
            Word.status == "verified",
            Word.id.notin_(prefix_ids),
            Word.english_meaning.ilike(f"%{q}%"),
        )
        .order_by(Word.char_count.asc())
        .all()
    )
    total = len(prefix) + len(inner)
    _mark_multiple_readings(prefix + inner)
    return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=total > 0)


def _search_english(db: Session, query: str) -> SearchResult:
    """Gemini fallback: ถ้า pinyin และ english_meaning ไม่เจอ — ถาม Gemini แล้ว exact match จาก chinese"""
    from ..services.translate_service import search_by_english

    suggestions = search_by_english(query)
    if not suggestions:
        return SearchResult(query=query, found=False)

    chinese_candidates = [s["chinese"] for s in suggestions if s.get("chinese")]
    if not chinese_candidates:
        return SearchResult(query=query, found=False)

    results = (
        db.query(Word)
        .filter(Word.status == "verified", Word.chinese.in_(chinese_candidates))
        .order_by(Word.char_count.asc())
        .all()
    )
    found = len(results) > 0
    _mark_multiple_readings(results)
    return SearchResult(query=query, prefix_group=results, inner_group=[], total=len(results), found=found)


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
