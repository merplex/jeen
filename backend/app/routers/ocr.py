import base64
import json
import logging
import re
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


_paddle_reader = None


def _get_paddle_reader():
    global _paddle_reader
    if _paddle_reader is None:
        from paddleocr import PaddleOCR
        _paddle_reader = PaddleOCR(use_angle_cls=True, lang='ch', use_gpu=False, show_log=False)
    return _paddle_reader


def _ocr_with_paddle(image_bytes: bytes) -> dict:
    """ใช้ PaddleOCR อ่านข้อความจีนจากรูป พร้อม detect alignment และ spatial info"""
    try:
        import numpy as np
        import cv2
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"lines": [], "is_chat": False}
        reader = _get_paddle_reader()
        result = reader.ocr(img, cls=True)
        if not result or not result[0]:
            return {"lines": [], "is_chat": False}
        img_w = img.shape[1]
        img_h = img.shape[0]
        items = []
        for item in result[0]:
            box, (text, confidence) = item
            min_conf = 0.3 if len(text) <= 2 else 0.5
            if confidence < min_conf:
                continue
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            x_min = min(xs) / img_w
            x_max = max(xs) / img_w
            cx = sum(xs) / 4 / img_w
            cy = sum(ys) / 4 / img_h
            # left: x_min น้อย = bubble เริ่มจากซ้าย (หลัง avatar) — ครอบคลุมทั้ง short และ long left bubble
            # right: ไม่ได้เริ่มจากซ้าย + x_max ชิดขวา
            # center: date divider / system message
            if x_min < 0.25:
                align = "left"
            elif x_max > 0.70:
                align = "right"
            else:
                align = "center"
            h = (max(ys) - min(ys)) / img_h
            items.append({
                "text": text,
                "align": align,
                "cx": cx,
                "cy": cy,
                "w": x_max - x_min,
                "size": h,
            })
        items.sort(key=lambda x: x["cy"])
        # ตัด status bar ออกเลย (top 6% = เวลา, แบต, สัญญาณ) — ทุก path
        items = [it for it in items if it["cy"] >= 0.06]
        # is_chat: ตรวจเฉพาะ items ที่อยู่ใต้ status bar zone (cy >= 0.08)
        content_items = [it for it in items if it["cy"] >= 0.08]
        aligns = [it["align"] for it in content_items]
        is_chat = "left" in aligns and "right" in aligns
        return {"lines": items, "is_chat": is_chat}
    except Exception as e:
        logger.error(f"[PaddleOCR] error: {e}")
        return {"lines": [], "is_chat": False}


def _ocr_and_translate(image_bytes: bytes, mime_type: str) -> dict:
    """Fallback: ส่งรูปให้ Gemini Vision อ่านข้อความจีนและแปลไทย (ใช้เมื่อ PaddleOCR ไม่มี)"""
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


_TIME_RE = re.compile(r'^\d{1,2}:\d{2}$')
_READ_RE = re.compile(r'^Read\s+\d{1,2}:\d{2}$', re.IGNORECASE)
_HEADER_SYMS = {'←', '→', '<', '>', '≡', '☰', '⋮', '⋯', '…'}
_FILE_EXTS = {'excel', 'pdf', 'csv', 'sheet', 'word', 'doc', 'docx', 'xlsx', 'ppt', 'pptx', 'zip', 'rar'}


def _is_time(text: str) -> bool:
    return bool(_TIME_RE.match(text.strip()))


def _is_read_receipt(text: str) -> bool:
    return bool(_READ_RE.match(text.strip()))


def _has_header_sym(text: str) -> bool:
    return any(s in text for s in _HEADER_SYMS) or '...' in text


def _is_file_ext(text: str) -> bool:
    t = text.lower()
    return any(e in t for e in _FILE_EXTS)


_THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]
_EN_MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
_EN_DAYS   = ["sun","mon","tue","wed","thu","fri","sat"]

def _is_date_text(text: str) -> bool:
    """ตรวจว่าข้อความเป็น date/system divider จริงๆ ไม่ใช่ bubble ที่ OCR classify center ผิด"""
    t = text.strip()
    tl = t.lower()
    if t.startswith("วัน"):
        return True
    for m in _THAI_MONTHS:
        if m in t:
            return True
    # English date patterns: "Sun, Mar 15", "Mon, Mar 16", "Mar 15" etc.
    for m in _EN_MONTHS:
        if m in tl:
            return True
    for d in _EN_DAYS:
        if tl.startswith(d):
            return True
    if re.search(r'\d{1,2}[/\-]\d{1,2}', t):
        return True
    # Chinese date patterns
    if re.search(r'\d{1,2}月\d{1,2}日', t):
        return True
    return False


def _detect_app_type(items: list) -> str:
    """detect LINE vs WeChat
    LINE-exclusive signal: 'Read HH:MM' หรือ 'Read' คนเดียว (PaddleOCR อาจอ่านแยก)
    ใช้ w < 0.3 กรองไม่ให้ชนกับคำว่า "Read" ในบทสนทนา
    """
    for it in items:
        t = it["text"].strip()
        w = it.get("w", 1)
        if _READ_RE.match(t):
            logger.info(f"[detect_app_type] LINE via Read+time: '{t}'")
            return "line"
        if t.lower() == "read" and w < 0.3:
            logger.info(f"[detect_app_type] LINE via solo Read w={w:.3f}: '{t}'")
            return "line"
    # log ทุก item ที่มีคำว่า read (ไม่ว่า w เท่าไร) เพื่อ debug
    for it in items:
        if "read" in it["text"].strip().lower():
            logger.info(f"[detect_app_type] Read-like item skipped: '{it['text'].strip()}' w={it.get('w',1):.3f} cy={it.get('cy',0):.3f}")
    return "wechat"


def _parse_chat_lines(items: list) -> list:
    """แปลง PaddleOCR items (with spatial info) เป็น structured chat format"""
    STATUSBAR_Y = 0.06   # fallback: ถ้าหา header ไม่เจอ ใช้ top 6% เป็น cutoff (match cy filter)

    # คำนวณ median size จาก items ทั้งหมดก่อน เพื่อใช้ detect header
    all_sizes = sorted([it["size"] for it in items if it.get("size", 0) > 0])
    median_size = all_sizes[len(all_sizes) // 2] if all_sizes else 0.04

    # --- หา header item ก่อนเลย (zone-based หรือ size-based) ---
    # จะใช้ตำแหน่งของ header เป็น cutoff — ทุกอย่างเหนือ header = status bar → skip
    header_item = None
    HEADER_Y = 0.18
    # header zone: ใช้ size เป็น primary signal (ชื่อ header มักใหญ่สุดในโซนนี้)
    # ไม่ require center align เพราะ long header text อาจถูก classify เป็น left/right
    header_zone = [it for it in items if it["cy"] < HEADER_Y]
    header_candidates = [
        it for it in header_zone
        if not _has_header_sym(it["text"].strip()) and not _is_time(it["text"].strip()) and len(it["text"].strip()) > 1
    ]
    if header_candidates:
        header_item = max(header_candidates, key=lambda x: x.get("size", 0))
    if header_item is None:
        for it in items:
            t = it["text"].strip()
            if it.get("size", 0) > median_size * 1.4 and not _has_header_sym(t) and not _is_time(t) and len(t) > 1:
                header_item = it
                break

    # cutoff_y = cy ของ header ถ้าเจอ, ไม่งั้นใช้ STATUSBAR_Y
    cutoff_y = header_item["cy"] if header_item else STATUSBAR_Y
    content_zone = [it for it in items if it["cy"] > cutoff_y]

    structured = []

    if header_item:
        structured.append({"type": "header", "text": header_item["text"].strip()})

    # --- Associate timestamps with bubbles ---
    times = [it for it in content_zone if _is_time(it["text"].strip())]
    bubbles = [it for it in content_zone if not _is_time(it["text"].strip())]

    bubble_times = {}   # bubble_index → time string
    used_time_idx = set()

    for ti, ts in enumerate(times):
        best_dist = 0.12  # max normalized y-distance
        best_bi = -1
        for bi, bub in enumerate(bubbles):
            if bi in bubble_times:
                continue
            yd = abs(ts["cy"] - bub["cy"])
            if yd < best_dist:
                # B (left bubble): timestamp is to the RIGHT
                # A (right bubble): timestamp is to the LEFT
                if (bub["align"] == "left" and ts["cx"] > bub["cx"]) or \
                   (bub["align"] == "right" and ts["cx"] < bub["cx"]):
                    best_dist = yd
                    best_bi = bi
        if best_bi >= 0:
            bubble_times[best_bi] = ts["text"].strip()
            used_time_idx.add(ti)

    # Orphaned timestamps → missing sticker/image bubble
    # ข้ามถ้า cy < 0.25 (น่าจะเป็น status bar หรือ header ที่หลุดมา)
    orphans = [(ti, ts) for ti, ts in enumerate(times)
               if ti not in used_time_idx and ts["cy"] >= 0.25]

    # Build content list sorted by cy
    content_list = [(bub, bubble_times.get(bi)) for bi, bub in enumerate(bubbles)]
    for _, ts in orphans:
        content_list.append((ts, None))
    content_list.sort(key=lambda x: x[0]["cy"])

    for it, time_str in content_list:
        text = it["text"].strip()

        # Orphaned timestamp → missing bubble
        if _is_time(text) and time_str is None:
            speaker = "B" if it["cx"] > 0.5 else "A"
            structured.append({"type": "missing_bubble", "speaker": speaker, "time": text})
            continue

        # Center → date/system divider (validate before classifying)
        if it["align"] == "center":
            if _is_date_text(text):
                structured.append({"type": "date", "text": text})
            else:
                speaker = "A" if it["cx"] > 0.5 else "B"
                structured.append({"type": "bubble", "speaker": speaker, "text": text, "time": time_str})
            continue

        speaker = "A" if it["align"] == "right" else "B"

        if _is_file_ext(text):
            structured.append({"type": "file", "speaker": speaker, "time": time_str})
        else:
            structured.append({"type": "bubble", "speaker": speaker, "text": text, "time": time_str})

    return structured


def _parse_chat_lines_line(items: list) -> list:
    """แปลง PaddleOCR items เป็น structured chat format สำหรับ LINE
    ความต่างจาก WeChat:
    - กรอง 'Read HH:MM' ออก (read receipt)
    - timestamp matching หลวมกว่า (อยู่ใต้ bubble แทนที่จะข้างๆ)
    """
    # กรอง LINE-specific noise ออก:
    # - "Read HH:MM" หรือ "Read" คนเดียว (read receipt)
    # - ตัวเลขล้วน 1-2 หลักใน header zone เช่น "31" (icon ปฏิทิน)
    def _is_line_noise(it: dict) -> bool:
        t = it["text"].strip()
        if _is_read_receipt(t):
            return True
        if t.lower() == "read" and it.get("w", 1) < 0.3:
            return True
        if t.isdigit() and len(t) <= 2 and it.get("cy", 1) < 0.18:
            return True
        return False

    items = [it for it in items if not _is_line_noise(it)]

    STATUSBAR_Y = 0.06
    all_sizes = sorted([it["size"] for it in items if it.get("size", 0) > 0])
    median_size = all_sizes[len(all_sizes) // 2] if all_sizes else 0.04

    HEADER_Y = 0.18
    header_item = None
    header_zone = [it for it in items if it["cy"] < HEADER_Y]
    header_candidates = [
        it for it in header_zone
        if not _has_header_sym(it["text"].strip()) and not _is_time(it["text"].strip())
        and not _is_read_receipt(it["text"].strip())
        and not it["text"].strip().isdigit()   # ไม่เอาตัวเลขล้วน (icon)
        and len(it["text"].strip()) > 1
    ]
    if header_candidates:
        # เลือก item ที่ยาวที่สุด (ชื่อ header มักยาวกว่า icon text)
        header_item = max(header_candidates, key=lambda x: len(x["text"].strip()))
    if header_item is None:
        for it in items:
            t = it["text"].strip()
            if it.get("size", 0) > median_size * 1.4 and not _has_header_sym(t) and not _is_time(t) and not t.isdigit() and len(t) > 1:
                header_item = it
                break

    cutoff_y = header_item["cy"] if header_item else STATUSBAR_Y
    content_zone = [it for it in items if it["cy"] > cutoff_y]

    structured = []
    if header_item:
        structured.append({"type": "header", "text": header_item["text"].strip()})

    times = [it for it in content_zone if _is_time(it["text"].strip())]
    bubbles = [it for it in content_zone if not _is_time(it["text"].strip())]

    bubble_times = {}
    used_time_idx = set()

    for ti, ts in enumerate(times):
        best_dist = 0.15  # LINE timestamp อยู่ใต้ bubble → ยอม y-distance มากกว่า WeChat
        best_bi = -1
        for bi, bub in enumerate(bubbles):
            if bi in bubble_times:
                continue
            yd = abs(ts["cy"] - bub["cy"])
            if yd < best_dist:
                # LINE: timestamp ขวาของ bubble ซ้าย หรือซ้ายของ bubble ขวา
                # แต่ก็อาจอยู่ใต้ตรงๆ (ไม่ strict cx มากเหมือน WeChat)
                if (bub["align"] == "left" and ts["cx"] >= bub["cx"] - 0.05) or \
                   (bub["align"] == "right" and ts["cx"] <= bub["cx"] + 0.05):
                    best_dist = yd
                    best_bi = bi
        if best_bi >= 0:
            bubble_times[best_bi] = ts["text"].strip()
            used_time_idx.add(ti)

    # LINE: orphan threshold ต่ำกว่า WeChat เพราะ content เริ่มจาก cy ~0.15
    orphans = [(ti, ts) for ti, ts in enumerate(times)
               if ti not in used_time_idx and ts["cy"] >= 0.15]

    content_list = [(bub, bubble_times.get(bi)) for bi, bub in enumerate(bubbles)]
    for _, ts in orphans:
        content_list.append((ts, None))
    content_list.sort(key=lambda x: x[0]["cy"])

    prev_cy = None
    prev_speaker = None
    for it, time_str in content_list:
        text = it["text"].strip()
        cy = it["cy"]

        if _is_time(text) and time_str is None:
            speaker = "A" if it["cx"] > 0.5 else "B"
            structured.append({"type": "missing_bubble", "speaker": speaker, "time": text})
            prev_cy = cy
            prev_speaker = speaker
            continue

        if it["align"] == "center":
            if _is_date_text(text):
                structured.append({"type": "date", "text": text})
                prev_cy = cy
                prev_speaker = None
            else:
                # ไม่ใช่ date — ดู cy proximity กับ item ก่อนหน้า
                if prev_speaker is not None and prev_cy is not None and (cy - prev_cy) < 0.04:
                    speaker = prev_speaker
                    print(f"[line_cy_inherit] '{text}' cy={cy:.3f} prev_cy={prev_cy:.3f} gap={cy-prev_cy:.3f} → inherit {speaker}", flush=True)
                else:
                    speaker = "A" if it["cx"] > 0.5 else "B"
                    print(f"[line_cy_inherit] '{text}' cy={cy:.3f} prev_cy={str(prev_cy)} gap={f'{cy-prev_cy:.3f}' if prev_cy else 'N/A'} → cx-based {speaker}", flush=True)
                structured.append({"type": "bubble", "speaker": speaker, "text": text, "time": time_str})
                prev_cy = cy
                prev_speaker = speaker
            continue

        speaker = "A" if it["align"] == "right" else "B"
        print(f"[line_item] '{text[:30]}' align={it['align']} cx={it['cx']:.3f} cy={cy:.3f} → {speaker}", flush=True)

        if _is_file_ext(text):
            structured.append({"type": "file", "speaker": speaker, "time": time_str})
        else:
            structured.append({"type": "bubble", "speaker": speaker, "text": text, "time": time_str})
        prev_cy = cy
        prev_speaker = speaker

    return structured


def _translate_chat_lines(chat_structure: list, all_words: list,
                           image_bytes: bytes = None, mime_type: str = None) -> str:
    """แปล chat structure เป็นไทย พร้อม format A:/B: timestamp"""
    from ..services.translate_service import _model, _has_api_key, _strip_markdown, _get_text
    from google.genai import types as genai_types

    if not _has_api_key() or not chat_structure:
        return ""

    lines = []
    for item in chat_structure:
        t = item["type"]
        if t == "header":
            lines.append(f"HEADER:{item['text']}")
        elif t == "date":
            lines.append(f"DATE:{item['text']}")
        elif t == "bubble":
            ts = item.get("time") or ""
            prefix = f"{item['speaker']}|{ts}" if ts else item['speaker']
            lines.append(f"{prefix}:{item['text']}")
        elif t == "file":
            ts = item.get("time") or ""
            prefix = f"{item['speaker']}|{ts}" if ts else item['speaker']
            lines.append(f"{prefix}:__FILE__")
        elif t == "missing_bubble":
            ts = item.get("time") or ""
            prefix = f"{item['speaker']}|{ts}" if ts else item['speaker']
            lines.append(f"{prefix}:__STICKER__")

    vocab_hint = ""
    if all_words:
        hints = ", ".join(
            f"{w.chinese}={(w.thai_meaning or '').split(chr(10))[0]}"
            for w in all_words[:20]
            if (w.thai_meaning or '').strip()
        )
        if hints:
            vocab_hint = f"\nคำศัพท์ช่วยแปล: {hints}"

    chat_input = "\n".join(lines)

    prompt = (
        "ด้านล่างคือบทสนทนาที่ PaddleOCR อ่านได้จากรูป ผู้พูดถูกระบุจากตำแหน่ง bubble แล้ว\n"
        "งานของคุณ: แปลข้อความจีนเป็นภาษาไทย แล้ว format ผลลัพธ์ตามกฎด้านล่าง\n\n"
        "กฎ format (บังคับ — ห้ามเปลี่ยนผู้พูด):\n"
        "  HEADER:ข้อความ  →  บทสนทนากับ [ชื่อที่ทับศัพท์]  (ไม่ต้องใส่ A B)\n"
        "  DATE:ข้อความ   →  แสดงวัน/เวลาแปลเป็นไทย  (ไม่ต้องใส่ A B)\n"
        "  A:ข้อความ      →  A : คำแปล\n"
        "  A|15:30:ข้อ    →  A : 15:30 : คำแปล\n"
        "  B:ข้อความ      →  B : คำแปล\n"
        "  B|15:30:ข้อ    →  B : 15:30 : คำแปล\n"
        "  A:__FILE__     →  A : ส่งไฟล์\n"
        "  A|15:30:__FILE__ →  A : 15:30 : ส่งไฟล์\n"
        "  B:__STICKER__  →  B : ส่งรูป/สติ๊กเกอร์\n"
        "  B|15:30:__STICKER__ →  B : 15:30 : ส่งรูป/สติ๊กเกอร์\n\n"
        "- A และ B ถูกกำหนดตายตัวจากตำแหน่งในรูป ห้ามเปลี่ยนแม้คิดว่าผิด\n"
        "- ห้ามมีอักษรจีนในคำตอบ\n"
        "- ตอบผลลัพธ์เท่านั้น ไม่อธิบายเพิ่ม\n"
        f"{vocab_hint}\n\n"
        f"{chat_input}"
    )

    try:
        if image_bytes and mime_type:
            image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            resp = _model.generate_content([prompt, image_part])
        else:
            resp = _model.generate_content(prompt)
        return _strip_markdown(_get_text(resp)).strip()
    except Exception as e:
        logger.error(f"[OCR chat translate] error: {e}")
        return ""


def _ocr_structured(image_bytes: bytes, mime_type: str) -> dict:
    """อ่านข้อความจีนแบบแยกบรรทัด ใช้ PaddleOCR หลัก, Gemini fallback"""
    # ลอง PaddleOCR ก่อน
    result = _ocr_with_paddle(image_bytes)
    if result["lines"]:
        is_chat = result.get("is_chat", False)
        lines = result["lines"]
        # Secondary check: ถ้า is_chat=False แต่มี header + bubble → ยังถือว่าเป็น chat
        # (เกิดเมื่อ right bubble สั้นโดน filter หรือ confidence ต่ำ)
        if not is_chat:
            top_items = [l for l in lines if l.get("cy", 1) < 0.22]
            has_header = any(
                len(l["text"].strip()) > 1 and not _has_header_sym(l["text"])
                for l in top_items
            )
            has_bubble = any(l.get("align") in ("left", "right") for l in lines if l.get("cy", 0) > 0.20)
            if has_header and has_bubble:
                is_chat = True
                logger.info("[OCR structured] is_chat promoted by header+bubble fallback")
        app_type = _detect_app_type(lines)
        logger.info(f"[OCR structured] PaddleOCR: {len(lines)} lines, is_chat={is_chat}, app={app_type}")
        if is_chat:
            if app_type == "line":
                chat_structure = _parse_chat_lines_line(lines)
            else:
                chat_structure = _parse_chat_lines(lines)
            return {"lines": lines, "is_chat": True, "chat_structure": chat_structure, "app_type": app_type}
        return {"lines": lines, "is_chat": False}

    # Fallback: ใช้ Gemini ถ้า PaddleOCR ไม่ได้ผล
    logger.info("[OCR structured] PaddleOCR empty, falling back to Gemini")
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
        logger.info(f"[OCR structured] gemini fallback: {len(valid)} lines")
        return {"lines": valid}
    except Exception as e:
        logger.error(f"[OCR structured] gemini error: {e}")
        return {"lines": []}


def _log_usage(db: Session, user_id: int | None, event_type: str):
    try:
        db.add(UsageEvent(user_id=user_id, event_type=event_type))
        db.commit()
    except Exception:
        db.rollback()


def _translate_lines_with_vocab(lines: list, all_words: list,
                                image_bytes: bytes = None, mime_type: str = None,
                                plain: bool = False) -> str:
    """Request 2: ส่ง lines + per-line vocab hints + รูปต้นฉบับ ให้ Gemini แปล
    plain=True → แปลตรงๆ ไม่ตรวจ conversation ไม่ใส่ชื่อผู้พูด (ใช้ใน translation ทั่วไป)
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

    # Request 1: OCR แกะตัวอักษร (fallback to flat OCR ถ้า structured ได้ว่าง)
    result = _ocr_structured(image_bytes, body.mime_type)
    lines = result.get("lines", [])
    is_chat = result.get("is_chat", False)
    chat_structure = result.get("chat_structure")
    app_type = result.get("app_type", "wechat")
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

    if not combined_text and not chat_structure:
        return {
            "lines": lines, "is_chat": is_chat, "app_type": app_type,
            "translation": "", "translation_chat": "",
            "words": [],
        }

    # สร้าง chat_structure เสมอ (ถ้ายังไม่มี) เพื่อใช้ใน translation_chat
    if not chat_structure and lines:
        if app_type == "line":
            chat_structure = _parse_chat_lines_line(lines)
        else:
            chat_structure = _parse_chat_lines(lines)

    # แปลทั้ง 2 รูปแบบพร้อมกัน
    translation_general = _translate_lines_with_vocab(lines, words, image_bytes, body.mime_type, plain=True)
    translation_chat = _translate_chat_lines(chat_structure, words, image_bytes, body.mime_type) if chat_structure else ""

    # Fallback ถ้า general fail
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
        "app_type": app_type,
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
