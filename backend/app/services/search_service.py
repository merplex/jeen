import re
from collections import Counter
from sqlalchemy.orm import Session

from ..models.word import Word
from ..models.missed_search import MissedSearch
from ..schemas.search import SearchResult, PerCharGroup


def _mark_multiple_readings(words: list) -> None:
    """Mark words whose chinese character appears more than once in the result set."""
    counts = Counter(w.chinese for w in words)
    for w in words:
        w.has_multiple_readings = counts[w.chinese] > 1


def detect_language(query: str) -> str:
    """Detect query type: position, mixed, chinese, english, thai."""
    if '@' in query:
        return 'position'
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in query)
    has_latin = any(c.isalpha() and ord(c) < 128 for c in query)
    if has_chinese and has_latin:
        return 'mixed'
    if has_chinese:
        return 'chinese'
    if all(ord(c) < 128 for c in query.replace(' ', '')):
        return 'english'
    return 'thai'


# ---------------------------------------------------------------------------
# Position search  (@饭, 吃@@, @rou, @饭rou, ...)
# ---------------------------------------------------------------------------

def _parse_position_query(q: str):
    """
    Parse @-based query into:
      - like_pattern: SQL LIKE pattern (@ → _, Chinese kept, pinyin → _)
      - expected_len: total expected char count
      - pinyin_checks: [(char_position_0indexed, pinyin_str), ...]
    """
    tokens = re.findall(r'@+|[\u4e00-\u9fff]+|[a-zA-Z]+', q)
    like_parts = []
    pinyin_checks = []
    pos = 0
    expected_len = 0

    for token in tokens:
        if all(c == '@' for c in token):
            count = len(token)
            like_parts.append('_' * count)
            pos += count
            expected_len += count
        elif any('\u4e00' <= c <= '\u9fff' for c in token):
            like_parts.append(token)
            pos += len(token)
            expected_len += len(token)
        else:
            # pinyin syllable — treat as 1 char
            pinyin_checks.append((pos, token.lower()))
            like_parts.append('_')
            pos += 1
            expected_len += 1

    like_pattern = ''.join(like_parts)
    return like_pattern, expected_len, pinyin_checks


def _search_by_position(db: Session, q: str) -> SearchResult:
    like_pattern, expected_len, pinyin_checks = _parse_position_query(q)

    filters = [Word.status == 'verified', Word.chinese.like(like_pattern)]
    if expected_len > 0:
        filters.append(Word.char_count == expected_len)

    candidates = (
        db.query(Word)
        .filter(*filters)
        .order_by(Word.char_count.asc())
        .limit(100)
        .all()
    )

    if pinyin_checks:
        results = []
        for w in candidates:
            syllables = (w.pinyin_plain or '').split()
            ok = True
            for char_pos, py in pinyin_checks:
                if char_pos >= len(syllables) or not syllables[char_pos].startswith(py):
                    ok = False
                    break
            if ok:
                results.append(w)
    else:
        results = candidates

    _mark_multiple_readings(results)
    return SearchResult(
        query=q,
        prefix_group=results,
        inner_group=[],
        total=len(results),
        found=len(results) > 0,
        search_mode='position',
    )


# ---------------------------------------------------------------------------
# Mixed Chinese + Pinyin search  (肌rou, 喝ni, ...)
# ---------------------------------------------------------------------------

def _search_mixed(db: Session, q: str) -> SearchResult:
    segments = re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z]+', q)
    chinese_str = ''.join(s for s in segments if any('\u4e00' <= c <= '\u9fff' for c in s))
    pinyin_str = ''.join(s.lower() for s in segments if s.isascii() and s.isalpha())
    cn_len = len(chinese_str)

    if not chinese_str:
        return SearchResult(query=q, found=False)

    # Stage 1: Words starting with Chinese part, remaining pinyin starts with pinyin_str
    candidates = (
        db.query(Word)
        .filter(Word.status == 'verified', Word.chinese.like(f'{chinese_str}%'))
        .order_by(Word.char_count.asc())
        .all()
    )

    exact = []
    for w in candidates:
        syllables = (w.pinyin_plain or '').split()
        if len(syllables) > cn_len:
            rest = ''.join(syllables[cn_len:])
            if rest.startswith(pinyin_str):
                exact.append(w)

    if exact:
        _mark_multiple_readings(exact)
        return SearchResult(query=q, prefix_group=exact, inner_group=[], total=len(exact), found=True)

    # Stage 2 fallback: Chinese prefix + inner + pinyin search merged
    cn_prefix = candidates  # words starting with chinese_str
    cn_prefix_ids = {w.id for w in cn_prefix}

    cn_inner = (
        db.query(Word)
        .filter(
            Word.status == 'verified',
            Word.id.notin_(cn_prefix_ids),
            Word.chinese.like(f'%{chinese_str}%'),
        )
        .order_by(Word.char_count.asc())
        .all()
    )
    cn_inner_ids = {w.id for w in cn_inner}

    # Pinyin results excluding already found
    all_cn_ids = cn_prefix_ids | cn_inner_ids
    py_res = _search_by_pinyin(db, pinyin_str)
    py_words = [w for w in py_res.prefix_group + py_res.inner_group if w.id not in all_cn_ids]

    prefix = cn_prefix
    inner = cn_inner + py_words
    total = len(prefix) + len(inner)

    _mark_multiple_readings(prefix + inner)
    return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=total > 0)


# ---------------------------------------------------------------------------
# Per-char fallback
# ---------------------------------------------------------------------------

def _search_per_char(db: Session, chars: list) -> list:
    """Search each char individually, return list of PerCharGroup."""
    groups = []
    seen_ids: set = set()
    for char in chars:
        prefix = (
            db.query(Word)
            .filter(Word.status == 'verified', Word.chinese.like(f'{char}%'))
            .order_by(Word.char_count.asc())
            .limit(20)
            .all()
        )
        prefix_ids = {w.id for w in prefix}
        inner = (
            db.query(Word)
            .filter(
                Word.status == 'verified',
                Word.id.notin_(prefix_ids | seen_ids),
                Word.chinese.like(f'%{char}%'),
            )
            .order_by(Word.char_count.asc())
            .limit(20)
            .all()
        )
        seen_ids |= prefix_ids | {w.id for w in inner}
        _mark_multiple_readings(prefix + inner)
        groups.append(PerCharGroup(char=char, prefix_group=prefix, inner_group=inner))
    return groups


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def search_words(db: Session, query: str) -> SearchResult:
    q = query.strip()
    if not q:
        return SearchResult(query=q, found=False)

    lang = detect_language(q)

    if lang == 'position':
        return _search_by_position(db, q)

    if lang == 'mixed':
        return _search_mixed(db, q)

    if lang == 'english':
        # 1) english_meaning column
        eng_result = _search_by_english_meaning(db, q)
        # 2) pinyin
        pin_result = _search_by_pinyin(db, q)

        if eng_result.found or pin_result.found:
            eng_ids = {w.id for w in (eng_result.prefix_group + eng_result.inner_group)}
            extra_prefix = [w for w in pin_result.prefix_group if w.id not in eng_ids]
            extra_inner = [w for w in pin_result.inner_group if w.id not in eng_ids]
            prefix = eng_result.prefix_group + extra_prefix
            inner = eng_result.inner_group + extra_inner
            total = len(prefix) + len(inner)
            _mark_multiple_readings(prefix + inner)
            return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=True)

        # 3) Gemini fallback — disabled (quota)
        return SearchResult(query=q, found=False)

    # Chinese or Thai — query column ตาม lang เท่านั้น (ไม่ OR ข้าม column เพื่อความเร็ว)
    if lang == 'chinese':
        prefix_col = Word.chinese.like(f'{q}%')
        inner_col = Word.chinese.like(f'%{q}%')
    else:  # thai
        prefix_col = Word.thai_meaning.like(f'{q}%')
        inner_col = Word.thai_meaning.like(f'%{q}%')

    prefix_results = (
        db.query(Word)
        .filter(Word.status == 'verified', prefix_col)
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )

    prefix_ids = {w.id for w in prefix_results}

    inner_results = (
        db.query(Word)
        .filter(Word.status == 'verified', Word.id.notin_(prefix_ids), inner_col)
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )

    total = len(prefix_results) + len(inner_results)
    found = total > 0

    all_results = prefix_results + inner_results
    _mark_multiple_readings(all_results)

    # Per-char fallback: Chinese query ≥ 2 chars with no results
    if not found and lang == 'chinese' and len(q) >= 2:
        chars = list(q)
        groups = _search_per_char(db, chars)
        if any(g.prefix_group or g.inner_group for g in groups):
            total_pc = sum(len(g.prefix_group) + len(g.inner_group) for g in groups)
            return SearchResult(
                query=q,
                per_char_groups=groups,
                total=total_pc,
                found=True,
                search_mode='per_char',
            )

    return SearchResult(
        query=q,
        prefix_group=prefix_results,
        inner_group=inner_results,
        total=total,
        found=found,
    )


# ---------------------------------------------------------------------------
# Helper searches
# ---------------------------------------------------------------------------

def _search_by_pinyin(db: Session, q: str) -> SearchResult:
    from sqlalchemy import func as sqlfunc
    q_ns = q.replace(' ', '')
    pinyin_ns = sqlfunc.replace(Word.pinyin_plain, ' ', '')

    prefix = (
        db.query(Word)
        .filter(Word.status == 'verified', pinyin_ns.ilike(f'{q_ns}%'))
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )
    prefix_ids = {w.id for w in prefix}
    inner = (
        db.query(Word)
        .filter(
            Word.status == 'verified',
            Word.id.notin_(prefix_ids),
            pinyin_ns.ilike(f'%{q_ns}%'),
        )
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )
    total = len(prefix) + len(inner)
    _mark_multiple_readings(prefix + inner)
    return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=total > 0)


def _search_by_english_meaning(db: Session, q: str) -> SearchResult:
    prefix = (
        db.query(Word)
        .filter(Word.status == 'verified', Word.english_meaning.ilike(f'{q}%'))
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )
    prefix_ids = {w.id for w in prefix}
    inner = (
        db.query(Word)
        .filter(
            Word.status == 'verified',
            Word.id.notin_(prefix_ids),
            Word.english_meaning.ilike(f'%{q}%'),
        )
        .order_by(Word.char_count.asc())
        .limit(80)
        .all()
    )
    total = len(prefix) + len(inner)
    _mark_multiple_readings(prefix + inner)
    return SearchResult(query=q, prefix_group=prefix, inner_group=inner, total=total, found=total > 0)


def _search_english(db: Session, query: str) -> SearchResult:
    from ..services.translate_service import search_by_english
    suggestions = search_by_english(query)
    if not suggestions:
        return SearchResult(query=query, found=False)

    chinese_candidates = [s['chinese'] for s in suggestions if s.get('chinese')]
    if not chinese_candidates:
        return SearchResult(query=query, found=False)

    results = (
        db.query(Word)
        .filter(Word.status == 'verified', Word.chinese.in_(chinese_candidates))
        .order_by(Word.char_count.asc())
        .all()
    )
    found = len(results) > 0
    _mark_multiple_readings(results)
    return SearchResult(query=query, prefix_group=results, inner_group=[], total=len(results), found=found)


def validate_and_record_missed(db: Session, query: str) -> bool:
    # ถ้าเคย validate แล้ว (อยู่ใน DB) → update count ตรงๆ ไม่ต้อง call Gemini ซ้ำ
    if db.query(MissedSearch).filter(MissedSearch.query == query).first():
        _record_missed(db, query)
        return True
    lang = detect_language(query)
    if lang != "chinese":
        return False  # validate เฉพาะจีน ภาษาอื่นไม่บันทึก
    from ..services.translate_service import validate_chinese_jieba
    if validate_chinese_jieba(query):
        _record_missed(db, query)
        return True
    return False


def _record_missed(db: Session, query: str):
    from datetime import datetime, timezone
    missed = db.query(MissedSearch).filter(MissedSearch.query == query).first()
    if missed:
        missed.count += 1
        missed.last_searched_at = datetime.now(timezone.utc).replace(tzinfo=None)
    else:
        missed = MissedSearch(query=query, count=1)
        db.add(missed)
    db.commit()
