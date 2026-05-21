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
    image_base64: str
    mime_type: str = "image/jpeg"


def _find_words_in_text(text: str, db: Session) -> list:
    if not text:
        return []
    all_words = db.query(Word).filter(Word.status == "verified").all()
    found = [w for w in all_words if w.chinese and w.chinese in text]
    found.sort(key=lambda w: len(w.chinese), reverse=True)
    return found[:30]


def _log_usage(db: Session, user_id: int | None, event_type: str):
    try:
        db.add(UsageEvent(user_id=user_id, event_type=event_type))
        db.commit()
    except Exception:
        db.rollback()


def _ocr_structured(image_bytes: bytes, mime_type: str) -> dict:
    """อ่านข้อความจีนแบบแยกบรรทัด + detect align ผ่าน Gemini Vision"""
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
        "      - bubble ชิดขอบขวาชัดเจน → right, ชิดซ้ายชัดเจน → left\n"
        "      - ไม่มี avatar เลยและดู position ไม่ออก → ใช้ align เดียวกับ bubble ก่อนหน้าที่ใกล้ที่สุด\n"
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
        aligns = [l["align"] for l in valid]
        is_chat = "left" in aligns and "right" in aligns
        logger.info(f"[OCR structured] {len(valid)} lines, is_chat={is_chat}")
        return {"lines": valid, "is_chat": is_chat}
    except Exception as e:
        logger.error(f"[OCR structured] gemini error: {e}")
        return {"lines": []}


def _translate_chat_via_vision(image_bytes: bytes, mime_type: str, all_words: list) -> str:
    """ส่งรูปทั้งใบให้ Gemini Vision วิเคราะห์บทสนทนาและแปลโดยตรง"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key():
        return ""

    vocab_hint = ""
    if all_words:
        pairs = "; ".join(f"{w.chinese}={w.thai_meaning}" for w in all_words[:20])
        vocab_hint = f"\nคำศัพท์ที่ควรแปลตรงตามนี้: {pairs}"

    prompt = (
        "รูปนี้คือ screenshot บทสนทนาจากแอปแชท (WeChat หรือ LINE)\n"
        "งานของคุณ: แปลข้อความจีนทุกอันเป็นภาษาไทย พร้อมระบุผู้พูด\n\n"
        "กฎระบุผู้พูด:\n"
        "- bubble ฝั่งขวา (สีเขียว/เข้ม) = A\n"
        "- bubble ฝั่งซ้าย (สีขาว/อ่อน) = B\n"
        "- ถ้าเห็นชื่อผู้ส่งเหนือ bubble ให้ใช้ชื่อนั้นแทน B เช่น B (Rosita)\n\n"
        "format ที่ต้องการ (แต่ละ message = 1 บรรทัด):\n"
        "บทสนทนากับ [ชื่อหน้าจอถ้ามี]\n"
        "A : [คำแปล]\n"
        "B : [คำแปล]\n"
        "B (Rosita) : [คำแปล]\n\n"
        "กฎเพิ่มเติม:\n"
        "- ข้ามข้อความที่เป็นแค่วัน/เวลากลาง เช่น 'Yesterday 13:51'\n"
        "- ถ้าเห็นรูป/สติ๊กเกอร์แทนข้อความ → เขียน '[ส่งรูป]'\n"
        "- ห้ามมีอักษรจีนในคำตอบ\n"
        "- ตอบผลลัพธ์เท่านั้น ไม่อธิบายเพิ่ม"
        f"{vocab_hint}"
    )

    try:
        image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        resp = _model.generate_content([prompt, image_part])
        return _strip_markdown(_get_text(resp)).strip()
    except Exception as e:
        logger.error(f"[chat vision] error: {e}")
        return ""


def _translate_lines_with_vocab(lines: list, all_words: list,
                                image_bytes: bytes = None, mime_type: str = None,
                                plain: bool = False) -> str:
    """แปล lines + per-line vocab hints ผ่าน Gemini"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key() or not lines:
        return ""

    def _has_chinese(t: str) -> bool:
        return any('一' <= c <= '鿿' for c in t)

    blocks = []
    for i, line in enumerate(lines):
        text = line.get("text", "")
        if not text or not _has_chinese(text):
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

    aligns = [l.get("align", "left") for l in lines if l.get("text")]
    is_conversation = not plain and "left" in aligns and "right" in aligns

    if is_conversation:
        speaker_rule = (
            "นี่คือบทสนทนา กฎบังคับ: right=A: left=B: (ห้ามสลับ ห้ามเปลี่ยน)\n"
            "ถ้าเห็นชื่อในภาพให้ใช้ชื่อนั้นแทน A หรือ B\n"
            "บรรทัดที่เป็น [ส่งรูป/อีโมจิ] → แสดงเป็น 'ส่งรูป/อีโมจิ' พร้อม A: หรือ B: ตาม align\n"
        )
    else:
        speaker_rule = "แปลตรงๆ ไม่ต้องใส่ชื่อผู้พูด\n"

    if plain:
        prompt = (
            "แปลข้อความต่อไปนี้เป็นภาษาไทย ไม่ต้องใส่ชื่อผู้พูด\n"
            "บรรทัดที่ขึ้นต้นด้วย 'คำศัพท์:' คือ hint สำหรับคุณเท่านั้น ห้ามใส่ในคำตอบ\n"
            "กฎ:\n"
            "1. บรรทัดที่ต่อเนื่องกันในย่อหน้าเดียวกัน ให้รวมเป็นย่อหน้าเดียว (ไม่ต้องแยกตาม [หมายเลข])\n"
            "2. ระหว่างย่อหน้าใหม่ เว้น 1 บรรทัดว่าง\n"
            "3. หัวข้อ/ชื่อเรื่อง ให้อยู่บรรทัดเดียว ตามด้วยบรรทัดว่าง\n"
            "4. ตอบคำแปลภาษาไทยเท่านั้น ไม่ใส่ [หมายเลข|align] ไม่อธิบายเพิ่ม\n"
            "5. ห้ามมีอักษรจีนในคำตอบเด็ดขาด แม้แปลไม่ออกให้ทับศัพท์\n"
            "6. ถ้าบรรทัดมีทั้งส่วนที่แปลได้และแปลไม่ได้ ให้แปลทีละส่วน\n\n"
            f"{structured_input}"
        )
    else:
        prompt = (
            "แปลข้อความต่อไปนี้เป็นภาษาไทย\n"
            f"{speaker_rule}"
            "บรรทัดที่ขึ้นต้นด้วย 'คำศัพท์:' คือ hint สำหรับคุณเท่านั้น ห้ามใส่ในคำตอบ\n"
            "กฎเพิ่มเติม:\n"
            "1. แต่ละ [หมายเลข|align] = 1 บรรทัดในคำแปล คั่นด้วย newline เรียงตามหมายเลข ห้ามสลับลำดับ\n"
            "2. ตอบคำแปลภาษาไทยเท่านั้น ไม่ใส่ [หมายเลข|align] และไม่อธิบายเพิ่ม\n"
            "3. ห้ามมีอักษรจีนในคำตอบเด็ดขาด แม้แปลไม่ออกให้ทับศัพท์เสมอ\n"
            "4. ถ้าบรรทัดมีทั้งส่วนที่แปลได้และแปลไม่ได้ ให้แปลทีละส่วน เช่น 裕龙聚丙烯PP-T30S（现货）→ ยู่หลง โพลีโพรพีลีน PP-T30S (สินค้าพร้อมส่ง)\n\n"
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

    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    is_chat = result.get("is_chat", False)
    combined_text = "".join(l["text"] for l in lines)

    if combined_text:
        _log_usage(db, current_user.id, "ocr_scan_structured")

    words = _find_words_in_text(combined_text, db)

    if not combined_text:
        return {
            "lines": lines, "is_chat": is_chat, "app_type": "",
            "translation": "", "translation_chat": "",
            "words": [],
        }

    translation_general = _translate_lines_with_vocab(lines, words, image_bytes, body.mime_type, plain=True)
    translation_chat = _translate_chat_via_vision(image_bytes, body.mime_type, words) if is_chat else ""

    if not translation_general and combined_text:
        from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
        try:
            resp = _model.generate_content(
                f"แปลข้อความจีนนี้เป็นภาษาไทย ตอบคำแปลเท่านั้น ไม่ต้องอธิบาย:\n{combined_text}"
            )
            translation_general = _strip_markdown(_get_text(resp)).strip()
        except Exception as e:
            logger.error(f"[OCR fallback translate] error: {e}")

    return {
        "lines": lines,
        "is_chat": is_chat,
        "app_type": "",
        "translation": translation_general,
        "translation_chat": translation_chat,
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

    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    text = "\n".join(l["text"] for l in lines)

    if not text:
        return {"text": "", "translation": "", "words": []}

    _log_usage(db, current_user.id, "ocr_scan")

    words = _find_words_in_text(text, db)
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
