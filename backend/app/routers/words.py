import re
from fastapi import APIRouter, Depends, HTTPException
from pypinyin.contrib.tone_convert import tone3_to_tone
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..models.activity_log import ActivityLog
from ..schemas.word import WordOut, WordCreate, WordUpdate
from ..auth import require_admin, require_user
from ..services.import_service import _gen_pinyin, _gen_pinyin_plain


def _numeric_to_tone_pinyin(s: str) -> str:
    """แปลง numeric pinyin → tone-marked: 'hao4chi1' → 'hào chī'"""
    syllables = re.findall(r'[a-zü:]+[1-5]?', s.strip().lower())
    return ' '.join(tone3_to_tone(syl) for syl in syllables if syl)

# mapping: tone-marked vowel → (base, tone_digit)
_TONE_VOWELS = {
    'ā': ('a', '1'), 'á': ('a', '2'), 'ǎ': ('a', '3'), 'à': ('a', '4'),
    'ē': ('e', '1'), 'é': ('e', '2'), 'ě': ('e', '3'), 'è': ('e', '4'),
    'ī': ('i', '1'), 'í': ('i', '2'), 'ǐ': ('i', '3'), 'ì': ('i', '4'),
    'ō': ('o', '1'), 'ó': ('o', '2'), 'ǒ': ('o', '3'), 'ò': ('o', '4'),
    'ū': ('u', '1'), 'ú': ('u', '2'), 'ǔ': ('u', '3'), 'ù': ('u', '4'),
    'ǖ': ('v', '1'), 'ǘ': ('v', '2'), 'ǚ': ('v', '3'), 'ǜ': ('v', '4'),
    'ü': ('v', ''),
}


def _normalize_pinyin_key(s: str) -> str:
    """
    Normalize pinyin to comparable key (strips spaces, handles both formats).
    'hǎo chī' → 'hao3chi1'
    'hao3chi1' → 'hao3chi1'
    'hào chī' → 'hao4chi1'
    """
    out, buf, tone = [], [], None
    for ch in s.lower().strip():
        if ch == ' ':
            if buf:
                out.extend(buf)
                if tone:
                    out.append(tone)
                buf.clear()
                tone = None
        elif ch in _TONE_VOWELS:
            base, t = _TONE_VOWELS[ch]
            buf.append(base)
            if t:
                tone = t
        elif ch in '12345' and buf:
            out.extend(buf)
            out.append(ch)
            buf.clear()
            tone = None
        elif ch.isalpha():
            buf.append(ch)
    if buf:
        out.extend(buf)
        if tone:
            out.append(tone)
    return ''.join(out)

router = APIRouter(prefix="/words", tags=["words"])


@router.get("/{word_id}", response_model=WordOut)
def get_word(
    word_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_user),
):
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
    existing_words = db.query(Word).filter(Word.chinese == data.chinese).all()
    if existing_words:
        if not data.pinyin:
            ids = ', '.join(str(w.id) for w in existing_words)
            raise HTTPException(
                status_code=409,
                detail=f"มีคำว่า '{data.chinese}' อยู่แล้ว (ID: {ids}) — ระบุ Pinyin เพื่อเพิ่มเป็นคำที่มีเสียงต่างกัน",
            )
        user_key = _normalize_pinyin_key(data.pinyin)
        for w in existing_words:
            if _normalize_pinyin_key(w.pinyin) == user_key:
                raise HTTPException(
                    status_code=409,
                    detail=f"มีคำว่า '{data.chinese}' เสียง '{data.pinyin}' อยู่แล้ว (ID: {w.id})",
                )

    d = data.model_dump()
    if not d.get("pinyin"):
        d["pinyin"] = _gen_pinyin(data.chinese)
    elif re.search(r'[1-5]', d["pinyin"]):
        # user กรอก numeric tone → แปลงเป็น tone-marked ก่อนเก็บ
        d["pinyin"] = _numeric_to_tone_pinyin(d["pinyin"])
    if not d.get("pinyin_plain"):
        d["pinyin_plain"] = _gen_pinyin_plain(data.chinese)

    db.add(ActivityLog(action="word_added", chinese=data.chinese, detail=f"ความหมาย: {data.thai_meaning[:60]}"))
    word = Word(**d, status="verified")
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
    changed_fields = []
    for field, value in data.model_dump(exclude_none=True).items():
        if getattr(word, field) != value:
            changed_fields.append(field)
        setattr(word, field, value)
    word.admin_edited = True
    detail = f"แก้ไข: {', '.join(changed_fields)}" if changed_fields else "แก้ไขข้อมูล"
    db.add(ActivityLog(action="word_edited", word_id=word.id, chinese=word.chinese, detail=detail))
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
