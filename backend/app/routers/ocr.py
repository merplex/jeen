import base64
import json
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..models.usage_event import UsageEvent
from ..models.subscription import UserSubscription
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/ocr", tags=["ocr"])

OCR_MONTHLY_LIMITS = {"free": 6, "learner": 60, "superuser": 600}


def _get_user_tier(user_id: int, db: Session) -> str:
    sub = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user_id, UserSubscription.status == "active")
        .first()
    )
    if not sub:
        return "free"
    if sub.expires_at and sub.expires_at < datetime.utcnow():
        return "free"
    if sub.product_id and "super" in sub.product_id:
        return "superuser"
    return "learner"


def _month_ocr_count(user_id: int, db: Session) -> int:
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(UsageEvent)
        .filter(
            UsageEvent.user_id == user_id,
            UsageEvent.event_type.in_(["ocr_scan", "ocr_scan_structured"]),
            UsageEvent.created_at >= month_start,
        )
        .count()
    )


def _check_ocr_quota(user: User, db: Session):
    if user.is_admin:
        return
    tier = _get_user_tier(user.id, db)
    count = _month_ocr_count(user.id, db)
    limit = OCR_MONTHLY_LIMITS.get(tier, 6)
    if count >= limit:
        raise HTTPException(status_code=429, detail={"quota_type": "ocr_monthly", "user_tier": tier})


class ScanRequest(BaseModel):
    image_base64: str  # base64 ของรูป (jpeg/png/webp)
    mime_type: str = "image/jpeg"


def _ocr_and_translate(image_bytes: bytes, mime_type: str) -> dict:
    """ส่งรูปให้ Gemini Vision อ่านข้อความจีนและแปลไทย"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key():
        return {"text": "", "translation": ""}

    image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    prompt = (
        "อ่านข้อความภาษาจีนทั้งหมดในรูปนี้ (รองรับแนวนอนและแนวตั้ง)\n"
        "ตอบเป็น JSON เท่านั้น:\n"
        "{\"text\":\"<ข้อความจีนทั้งหมดที่อ่านได้>\",\"translation\":\"<แปลเป็นภาษาไทย>\"}\n"
        "ถ้าไม่มีข้อความจีนในรูป ให้ตอบ: {\"text\":\"\",\"translation\":\"\"}"
    )

    try:
        resp = _model.generate_content([prompt, image_part])
        raw = _strip_markdown(_get_text(resp))
        data = json.loads(raw)
        return {"text": data.get("text", ""), "translation": data.get("translation", "")}
    except Exception:
        return {"text": "", "translation": ""}


def _find_words_in_text(text: str, db: Session) -> list:
    """หาคำศัพท์ใน DB ที่ปรากฏในข้อความ โดย load คำทั้งหมดแล้ว filter ใน Python"""
    if not text:
        return []
    all_words = db.query(Word).filter(Word.status == "verified").all()
    found = [w for w in all_words if w.chinese and w.chinese in text]
    found.sort(key=lambda w: len(w.chinese), reverse=True)
    return found[:30]


def _ocr_structured(image_bytes: bytes, mime_type: str) -> dict:
    """ส่งรูปให้ Gemini Vision อ่านข้อความจีนแบบแยกบรรทัด/ส่วน พร้อมแปลไทย"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key():
        return {"lines": []}

    image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)

    prompt = (
        "อ่านภาพนี้ทั้งหมด แล้วแปลงเป็น JSON\n"
        "ตอบเป็น JSON เท่านั้น:\n"
        "{\"lines\":[{\"text\":\"<ข้อความ>\",\"align\":\"<left|right|center>\"}]}\n"
        "กฎ:\n"
        "1. ถ้าเป็นข้อความจีน → ใส่ข้อความนั้นใน text\n"
        "   ถ้ามีชื่อเล็กๆ อยู่เหนือ bubble (เช่นในกลุ่มแชท) ให้รวมชื่อไว้ใน text ด้วย รูปแบบ: \"ชื่อ: ข้อความ\"\n"
        "2. ถ้าเป็นรูปภาพ/สติ๊กเกอร์/อีโมจิ/GIF ที่ไม่มีตัวอักษร → text = \"[ส่งรูป/อีโมจิ]\"\n"
        "   ถ้ามีชื่อเหนือรูปนั้นด้วย → text = \"ชื่อ: [ส่งรูป/อีโมจิ]\"\n"
        "3. แต่ละ element = 1 bubble หรือ 1 ส่วนที่แยกจากกัน เรียงจากบนลงล่างตามตำแหน่งจริงในภาพ ห้ามสลับลำดับ\n"
        "4. การหา align ให้ดูตามลำดับนี้:\n"
        "   ก. มี avatar เล็กๆ ระดับเดียวกับ bubble ไหม?\n"
        "      - avatar อยู่ขวา → right, avatar อยู่ซ้าย → left\n"
        "   ข. ไม่มี avatar → ดู pattern ของ bubble:\n"
        "      - ข้อความ/bubble กว้าง + avatar/รูปเล็กอยู่ขวา → right\n"
        "      - avatar/รูปเล็กอยู่ซ้าย + ข้อความ/bubble → left\n"
        "      - bubble ชิดขอบขวาชัดเจน → right, ชิดซ้ายชัดเจน → left\n"
        "      - ไม่มี avatar เลยและดู position ไม่ออก → ใช้ align เดียวกับ bubble ก่อนหน้าที่ใกล้ที่สุด (คนเดิมพิมพ์ต่อเนื่อง)\n"
        "5. บรรทัดบนสุดของภาพ: ถ้าเป็นแค่ข้อความกลาง หรือมีลูกศร (← →) หรือ ... อยู่ข้างๆ\n"
        "   แสดงว่าเป็น header ชื่อกลุ่ม/หัวข้อสนทนา → ข้ามไม่ต้องใส่ใน lines\n"
        "6. ถ้าไม่มีอะไรเลยในรูป ตอบ: {\"lines\":[]}"
    )

    try:
        resp = _model.generate_content([prompt, image_part])
        raw = _strip_markdown(_get_text(resp))
        logger.info(f"[OCR structured] gemini raw: {raw[:300]}")
        data = json.loads(raw)
        lines = data.get("lines", [])
        valid = [
            {"text": l.get("text", ""), "align": l.get("align", "left")}
            for l in lines if isinstance(l, dict) and l.get("text")
        ]
        logger.info(f"[OCR structured] valid lines: {len(valid)}")
        return {"lines": valid}
    except Exception as e:
        logger.error(f"[OCR structured] error: {e}")
        return {"lines": []}


def _log_usage(db: Session, user_id: int | None, event_type: str):
    try:
        db.add(UsageEvent(user_id=user_id, event_type=event_type))
        db.commit()
    except Exception:
        db.rollback()


def _translate_lines_with_vocab(lines: list, all_words: list,
                                image_bytes: bytes = None, mime_type: str = None) -> str:
    """Request 2: ส่ง lines + per-line vocab hints + รูปต้นฉบับ ให้ Gemini แปล
    - รักษา line breaks ตามต้นฉบับ
    - ดู layout จากรูป: chat bubble / book dialogue / article
    - ระบุผู้พูดถ้าเป็นบทสนทนา
    """
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key() or not lines:
        return ""

    # Build per-line blocks with vocab hints
    blocks = []
    for i, line in enumerate(lines):
        text = line.get("text", "")
        if not text:
            continue
        line_words = [w for w in all_words if w.chinese and w.chinese in text]
        line_words.sort(key=lambda w: len(w.chinese), reverse=True)

        align = line.get("align", "left")
        block = f"[{i+1}|{align}] {text}"
        if line_words:
            hints = ", ".join(
                f"{w.chinese}={(w.thai_meaning or '').split(chr(10))[0]}"
                for w in line_words[:10]
                if (w.thai_meaning or '').strip()
            )
            block += f"\n    คำศัพท์: {hints}"
        blocks.append(block)

    if not blocks:
        return ""

    structured_input = "\n\n".join(blocks)

    # ถ้ามีทั้ง left และ right = บทสนทนาแน่นอน ไม่ต้องให้ Gemini เดา
    aligns = [l.get("align", "left") for l in lines if l.get("text")]
    is_conversation = "left" in aligns and "right" in aligns

    if is_conversation:
        speaker_rule = (
            "นี่คือบทสนทนา กฎบังคับ: right=A: left=B: (ห้ามสลับ ห้ามเปลี่ยน)\n"
            "ถ้าเห็นชื่อในภาพให้ใช้ชื่อนั้นแทน A หรือ B\n"
            "บรรทัดที่เป็น [ส่งรูป/อีโมจิ] → แสดงเป็น 'ส่งรูป/อีโมจิ' พร้อม A: หรือ B: ตาม align\n"
        )
    else:
        speaker_rule = "แปลตรงๆ ไม่ต้องใส่ชื่อผู้พูด\n"

    prompt = (
        "แปลข้อความต่อไปนี้เป็นภาษาไทย\n"
        f"{speaker_rule}"
        "กฎเพิ่มเติม:\n"
        "1. แต่ละ [หมายเลข|align] = 1 บรรทัดในคำแปล คั่นด้วย newline เรียงตามหมายเลข ห้ามสลับลำดับ\n"
        "2. ตอบคำแปลภาษาไทยเท่านั้น ไม่ใส่ [หมายเลข|align] และไม่อธิบายเพิ่ม\n\n"
        f"{structured_input}"
    )

    try:
        if image_bytes and mime_type:
            image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            resp = _model.generate_content([prompt, image_part])
        else:
            resp = _model.generate_content(prompt)
        return _strip_markdown(_get_text(resp)).strip()
    except Exception as e:
        logger.error(f"[OCR translate] error: {e}")
        return ""


@router.post("/scan-structured")
def scan_image_structured(
    body: ScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    _check_ocr_quota(current_user, db)
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 ไม่ถูกต้อง")

    # Request 1: OCR แกะตัวอักษร (fallback to flat OCR ถ้า structured ได้ว่าง)
    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    if not lines:
        flat = _ocr_and_translate(image_bytes, body.mime_type)
        if flat.get("text"):
            lines = [{"text": flat["text"], "translation": flat.get("translation", "")}]
    combined_text = "".join(l["text"] for l in lines)

    # นับเฉพาะเมื่อเจอข้อความจริง
    if combined_text:
        _log_usage(db, current_user.id, "ocr_scan_structured")

    # Match DB
    words = _find_words_in_text(combined_text, db)

    # Request 2: แปลแบบ structured per-line + vocab hints + image context
    if combined_text:
        full_translation = _translate_lines_with_vocab(lines, words, image_bytes, body.mime_type)
        # Fallback: ถ้า call 2 fail ให้แปลตรงๆ จากข้อความที่อ่านได้
        if not full_translation:
            from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
            try:
                resp = _model.generate_content(
                    f"แปลข้อความจีนนี้เป็นภาษาไทย ตอบคำแปลเท่านั้น ไม่ต้องอธิบาย:\n{combined_text}"
                )
                full_translation = _strip_markdown(_get_text(resp)).strip()
            except Exception as e:
                logger.error(f"[OCR fallback translate] error: {e}")
                full_translation = ""
    else:
        full_translation = ""

    return {
        "lines": lines,
        "translation": full_translation,
        "words": [
            {
                "id": w.id,
                "chinese": w.chinese,
                "pinyin": w.pinyin,
                "thai_meaning": w.thai_meaning,
            }
            for w in words
        ],
    }


@router.post("/scan")
def scan_image(
    body: ScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    _check_ocr_quota(current_user, db)
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 ไม่ถูกต้อง")

    # Request 1: OCR แกะตัวอักษร แบบแยก lines (fallback to flat OCR ถ้าได้ว่าง)
    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    if not lines:
        flat = _ocr_and_translate(image_bytes, body.mime_type)
        if flat.get("text"):
            lines = [{"text": flat["text"], "translation": flat.get("translation", "")}]
    text = "\n".join(l["text"] for l in lines)

    if not text:
        return {"text": "", "translation": "", "words": []}

    # นับเฉพาะเมื่อเจอข้อความจริง
    _log_usage(db, current_user.id, "ocr_scan")

    # Match DB
    words = _find_words_in_text(text, db)

    # Request 2: แปลแบบ structured lines + vocab hints + image context
    translation = _translate_lines_with_vocab(lines, words, image_bytes, body.mime_type)

    return {
        "text": text,
        "translation": translation,
        "words": [
            {
                "id": w.id,
                "chinese": w.chinese,
                "pinyin": w.pinyin,
                "thai_meaning": w.thai_meaning,
            }
            for w in words
        ],
    }
