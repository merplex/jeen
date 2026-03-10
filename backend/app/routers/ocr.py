import base64
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..auth import require_user
from ..models.user import User

router = APIRouter(prefix="/ocr", tags=["ocr"])


class ScanRequest(BaseModel):
    image_base64: str  # base64 ของรูป (jpeg/png/webp)
    mime_type: str = "image/jpeg"


def _ocr_and_translate(image_bytes: bytes, mime_type: str) -> dict:
    """ส่งรูปให้ Gemini Vision อ่านข้อความจีนและแปลไทย"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text

    if not _has_api_key():
        return {"text": "", "translation": ""}

    image_part = {"mime_type": mime_type, "data": image_bytes}

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
    return found[:20]


def _ocr_structured(image_bytes: bytes, mime_type: str) -> dict:
    """ส่งรูปให้ Gemini Vision อ่านข้อความจีนแบบแยกบรรทัด/ส่วน พร้อมแปลไทย"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text

    if not _has_api_key():
        return {"lines": []}

    image_part = {"mime_type": mime_type, "data": image_bytes}

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
        data = json.loads(raw)
        lines = data.get("lines", [])
        valid = [
            {"text": l.get("text", ""), "translation": l.get("translation", "")}
            for l in lines if isinstance(l, dict) and l.get("text")
        ]
        return {"lines": valid}
    except Exception:
        return {"lines": []}


@router.post("/scan-structured")
def scan_image_structured(
    body: ScanRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_user),
):
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 ไม่ถูกต้อง")

    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    combined_text = "".join(l["text"] for l in lines)
    words = _find_words_in_text(combined_text, db)

    return {
        "lines": lines,
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
    _: User = Depends(require_user),
):
    try:
        image_bytes = base64.b64decode(body.image_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_base64 ไม่ถูกต้อง")

    result = _ocr_and_translate(image_bytes, body.mime_type)
    text = result.get("text", "")
    translation = result.get("translation", "")

    if not text:
        return {"text": "", "translation": "", "words": []}

    words = _find_words_in_text(text, db)

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
