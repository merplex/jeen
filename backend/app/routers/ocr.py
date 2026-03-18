import base64
import json
import logging
from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..models.usage_event import UsageEvent
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/ocr", tags=["ocr"])


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
        "อ่านข้อความภาษาจีนในรูปนี้ทั้งหมด (รองรับแนวนอนและแนวตั้ง)\n"
        "แบ่งตามบรรทัดหรือส่วนของข้อความที่ดูแยกจากกัน\n"
        "ตอบเป็น JSON เท่านั้น:\n"
        "{\"lines\":[{\"text\":\"<ข้อความจีน>\",\"translation\":\"<แปลเป็นภาษาไทย>\"}]}\n"
        "กฎ: แต่ละ element = 1 บรรทัด หรือ 1 ส่วนที่แยกกันในภาพ "
        "ถ้าข้อความอยู่ใกล้กัน/บรรทัดเดียวกัน รวมเป็น element เดียว "
        "ถ้าห่างกันหรือดูเป็นคนละส่วน แบ่งเป็นคนละ element "
        "ถ้าไม่มีข้อความจีนในรูป ตอบ: {\"lines\":[]}"
    )

    try:
        resp = _model.generate_content([prompt, image_part])
        raw = _strip_markdown(_get_text(resp))
        logger.info(f"[OCR structured] gemini raw: {raw[:300]}")
        data = json.loads(raw)
        lines = data.get("lines", [])
        valid = [
            {"text": l.get("text", ""), "translation": l.get("translation", "")}
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


def _translate_lines_with_vocab(lines: list, all_words: list) -> str:
    """Request 2: ส่ง lines แบบ structured + per-line vocab hints ให้ Gemini แปล
    - รักษา line breaks ตามต้นฉบับ
    - ระบุผู้พูดถ้าเป็นบทสนทนา
    """
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text

    if not _has_api_key() or not lines:
        return ""

    # Build per-line blocks with vocab hints
    blocks = []
    for i, line in enumerate(lines):
        text = line.get("text", "")
        if not text:
            continue
        # find words that appear in this specific line
        line_words = [w for w in all_words if w.chinese and w.chinese in text]
        line_words.sort(key=lambda w: len(w.chinese), reverse=True)

        block = f"[{i+1}] {text}"
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

    prompt = (
        "แปลข้อความจีนต่อไปนี้เป็นภาษาไทย\n"
        "กฎ:\n"
        "1. แต่ละ [หมายเลข] = 1 บรรทัดในคำแปล คั่นด้วย newline\n"
        "2. อ่าน content แล้วตัดสินใจ:\n"
        "   - ถ้าเป็นบทสนทนา (คนโต้ตอบกัน, ประโยคสั้น, มีการถามตอบ) "
        "→ ขึ้นต้นทุกบรรทัดด้วย A: หรือ B: สลับกัน (ถ้ารู้ชื่อใช้ชื่อ)\n"
        "   - ถ้าเป็นบทความ/ป้าย/ข้อความทั่วไป → แปลตรงๆ ไม่ต้องใส่ A: B:\n"
        "3. ตอบคำแปลภาษาไทยเท่านั้น ไม่ใส่ [หมายเลข] และไม่อธิบายเพิ่ม\n\n"
        f"{structured_input}"
    )

    try:
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

    # Request 2: แปลแบบ structured per-line + vocab hints
    if combined_text:
        full_translation = _translate_lines_with_vocab(lines, words)
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
    text = "".join(l["text"] for l in lines)

    if not text:
        return {"text": "", "translation": "", "words": []}

    # นับเฉพาะเมื่อเจอข้อความจริง
    _log_usage(db, current_user.id, "ocr_scan")

    # Match DB
    words = _find_words_in_text(text, db)

    # Request 2: แปลแบบ structured lines + vocab hints
    translation = _translate_lines_with_vocab(lines, words)

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
