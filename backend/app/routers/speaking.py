import os
import base64
import json
import random
import httpx
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.speaking import SpeakingRecord
from ..models.subscription import UserSubscription
from ..models.usage_event import UsageEvent
from ..models.user import User
from ..auth import require_user

router = APIRouter(prefix="/speaking", tags=["speaking"])

MONTHLY_SPEAK_LIMITS = {"free": 3, "learner": 30, "superuser": 300}
FREE_GEN_LIMIT = 1         # gen ประโยคใหม่ 1 ครั้ง/วัน


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


def _has_subscription(user_id: int, db: Session) -> bool:
    return _get_user_tier(user_id, db) != "free"


def _month_speak_count(user_id: int, db: Session) -> int:
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(UsageEvent)
        .filter(
            UsageEvent.user_id == user_id,
            UsageEvent.event_type == "speaking_assess",
            UsageEvent.created_at >= month_start,
        )
        .count()
    )


def _log_speak_event(db: Session, user_id: int):
    try:
        db.add(UsageEvent(user_id=user_id, event_type="speaking_assess"))
        db.commit()
    except Exception:
        db.rollback()


def _today_practice_count(user_id: int, db: Session) -> int:
    today_start = datetime.combine(date.today(), datetime.min.time())
    return (
        db.query(SpeakingRecord)
        .filter(SpeakingRecord.user_id == user_id, SpeakingRecord.practiced_at >= today_start)
        .with_entities(SpeakingRecord.id)
        # นับ practice_count ที่เพิ่มวันนี้ไม่ได้ง่าย — ใช้ daily_assess_count field แทน
        # ง่ายกว่า: เก็บ count แยกใน daily_counts (ใช้ Redis หรือ column)
        # สำหรับตอนนี้: นับจาก practiced_at วันนี้ (แต่ละ row = 1 ครั้งแรก)
        # ฝึกซ้ำ = practice_count เพิ่ม แต่ไม่มี row ใหม่ → ต้องเก็บ daily_assess_count
        .count()
    )


def _today_assess_count(user_id: int, db: Session) -> int:
    """นับจำนวนครั้งที่ assess วันนี้ (รวมฝึกซ้ำ)"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    rows = (
        db.query(SpeakingRecord.daily_assess_count, SpeakingRecord.practiced_at)
        .filter(SpeakingRecord.user_id == user_id, SpeakingRecord.practiced_at >= today_start)
        .all()
    )
    return sum(r.daily_assess_count or 0 for r in rows)


def _today_gen_count(user_id: int, db: Session) -> int:
    """นับจำนวนครั้ง gen ประโยคใหม่วันนี้"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    from sqlalchemy import func
    result = (
        db.query(func.sum(SpeakingRecord.daily_gen_count))
        .filter(SpeakingRecord.user_id == user_id, SpeakingRecord.practiced_at >= today_start)
        .scalar()
    )
    return result or 0


def _assess_sdk_sync(audio_bytes: bytes, reference_text: str, key: str, region: str) -> dict | None:
    """ใช้ Azure Speech SDK — รองรับ ProsodyScore (โทนเสียง) ที่ REST API ไม่มี"""
    import tempfile, os as _os
    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        return None

    speech_config = speechsdk.SpeechConfig(subscription=key, region=region)
    speech_config.speech_recognition_language = "zh-CN"

    pa_config = speechsdk.PronunciationAssessmentConfig(
        reference_text=reference_text,
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Word,
        enable_miscue=True,
    )
    pa_config.enable_prosody_assessment()

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(audio_bytes)
    tmp.close()
    try:
        audio_cfg = speechsdk.AudioConfig(filename=tmp.name)
        try:
            recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_cfg)
        except Exception:
            return None
        pa_config.apply_to(recognizer)
        result = recognizer.recognize_once_async().get()
        if result.reason != speechsdk.ResultReason.RecognizedSpeech:
            print(f"[Azure SDK] reason={result.reason}")
            return None
        pa = speechsdk.PronunciationAssessmentResult(result)
        word_results = []
        try:
            for w in (pa.words or []):
                try:
                    error = w.error_type.name if w.error_type is not None else "None"
                except Exception:
                    error = "None"
                word_results.append({
                    "word": w.word,
                    "accuracy_score": round(w.accuracy_score or 0, 1),
                    "error_type": error,
                })
        except Exception:
            word_results = []
        return {
            "pronunciation_score": round(pa.accuracy_score or 0, 1),
            "tone_score": round(pa.prosody_score or 0, 1),
            "fluency_score": round(pa.fluency_score or 0, 1),
            "words": word_results,
        }
    except Exception:
        return None
    finally:
        _os.unlink(tmp.name)


async def _assess_azure(audio_base64: str, reference_text: str) -> dict | None:
    key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        return None

    import asyncio, concurrent.futures
    audio_bytes = base64.b64decode(audio_base64)
    loop = asyncio.get_event_loop()
    try:
        with concurrent.futures.ThreadPoolExecutor() as pool:
            result = await loop.run_in_executor(pool, _assess_sdk_sync, audio_bytes, reference_text, key, region)
        return result
    except Exception:
        return None


def _mock_scores(reference_text: str = "") -> dict:
    """Mock ที่สมจริงกว่า — โทนยากสุด, ไม่ค่อยได้คะแนนสูง"""
    # Mock word-level: แตกเป็น token ตามตัวอักษรจีน (แต่ละตัว = 1 word)
    word_results = []
    for char in reference_text:
        if '\u4e00' <= char <= '\u9fff':
            score = round(random.triangular(10, 100, 55), 1)
            error = random.choices(["None", "Mispronunciation"], weights=[70, 30])[0]
            word_results.append({"word": char, "accuracy_score": score, "error_type": error})
    return {
        "pronunciation_score": round(random.triangular(10, 80, 42), 1),
        "tone_score": round(random.triangular(5, 70, 28), 1),
        "fluency_score": round(random.triangular(15, 78, 38), 1),
        "words": word_results,
    }


class AssessRequest(BaseModel):
    word_id: int
    example_id: int          # 0 = generated sentence
    example_chinese: str
    example_pinyin: str = ""
    is_generated: bool = False
    audio_base64: str


class GenerateSentencesRequest(BaseModel):
    word_id: int
    chinese: str
    pinyin: str
    thai_meaning: str


@router.post("/assess")
async def assess_speaking(
    body: AssessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    # ตรวจโควต้ารายเดือน
    if not current_user.is_admin:
        tier = _get_user_tier(current_user.id, db)
        month_count = _month_speak_count(current_user.id, db)
        limit = MONTHLY_SPEAK_LIMITS.get(tier, 3)
        if month_count >= limit:
            raise HTTPException(
                status_code=429,
                detail={"quota_type": "speaking_monthly", "user_tier": tier},
            )

    scores = await _assess_azure(body.audio_base64, body.example_chinese)
    is_mock = scores is None
    if scores is None:
        scores = _mock_scores(body.example_chinese)

    # แยก word-level ออกก่อน — ไม่บันทึกลง DB (per-session only)
    word_scores = scores.pop("words", [])

    new_total = scores["pronunciation_score"] + scores["tone_score"] + scores["fluency_score"]
    is_improved = False

    if body.is_generated or body.example_id == 0:
        # Generated sentence — บันทึกลง history ด้วย stable negative ID
        # ใช้ hash(word_id + chinese) เพื่อให้ฝึกซ้ำประโยคเดิมได้
        import hashlib
        gen_id = -abs(int(hashlib.md5(f"{body.word_id}:{body.example_chinese}".encode()).hexdigest(), 16) % 10**9)

        existing = db.query(SpeakingRecord).filter(
            SpeakingRecord.user_id == current_user.id,
            SpeakingRecord.example_id == gen_id,
        ).first()

        if existing:
            old_total = existing.pronunciation_score + existing.tone_score + existing.fluency_score
            existing.practice_count += 1
            existing.daily_assess_count = (existing.daily_assess_count or 0) + 1
            existing.practiced_at = datetime.utcnow()
            if new_total > old_total:
                existing.pronunciation_score = scores["pronunciation_score"]
                existing.tone_score = scores["tone_score"]
                existing.fluency_score = scores["fluency_score"]
                is_improved = True
            db.commit()
        else:
            record = SpeakingRecord(
                user_id=current_user.id,
                word_id=body.word_id,
                example_id=gen_id,
                example_chinese=body.example_chinese,
                example_pinyin=body.example_pinyin or None,
                is_generated=True,
                daily_assess_count=1,
                **scores,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            is_improved = True
    else:
        existing = db.query(SpeakingRecord).filter(
            SpeakingRecord.user_id == current_user.id,
            SpeakingRecord.example_id == body.example_id,
        ).first()

        if existing:
            old_total = existing.pronunciation_score + existing.tone_score + existing.fluency_score
            existing.practice_count += 1
            existing.daily_assess_count = (existing.daily_assess_count or 0) + 1
            existing.practiced_at = datetime.utcnow()
            if new_total > old_total:
                existing.pronunciation_score = scores["pronunciation_score"]
                existing.tone_score = scores["tone_score"]
                existing.fluency_score = scores["fluency_score"]
                is_improved = True
            db.commit()
        else:
            record = SpeakingRecord(
                user_id=current_user.id,
                word_id=body.word_id,
                example_id=body.example_id,
                example_chinese=body.example_chinese,
                example_pinyin=body.example_pinyin or None,
                daily_assess_count=1,
                **scores,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            is_improved = True

    # log usage event
    _log_speak_event(db, current_user.id)

    return {**scores, "words": word_scores, "is_improved": is_improved, "mock": is_mock}


@router.post("/generate-sentences")
def generate_sentences(
    body: GenerateSentencesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    is_premium = current_user.is_admin or _has_subscription(current_user.id, db)

    # ตรวจโควต้า gen
    if not is_premium:
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_records = (
            db.query(SpeakingRecord)
            .filter(SpeakingRecord.user_id == current_user.id, SpeakingRecord.practiced_at >= today_start)
            .all()
        )
        today_gen = sum(r.daily_gen_count or 0 for r in today_records)
        if today_gen >= FREE_GEN_LIMIT:
            raise HTTPException(
                status_code=403,
                detail=f"gen ประโยคฟรีได้ {FREE_GEN_LIMIT} ครั้ง/วัน",
            )

    from ..services.translate_service import _has_api_key, _model, _strip_markdown, _get_text

    if not _has_api_key():
        # mock
        return [
            {"chinese": f"{body.chinese}很重要。", "pinyin": "", "thai": f"{body.chinese} สำคัญมาก"},
            {"chinese": f"我喜欢{body.chinese}。", "pinyin": "", "thai": f"ฉันชอบ{body.chinese}"},
            {"chinese": f"请解释{body.chinese}。", "pinyin": "", "thai": f"กรุณาอธิบาย{body.chinese}"},
        ]

    prompt = f"""สร้างประโยคตัวอย่างภาษาจีนกลาง 3 ประโยคสำหรับคำว่า "{body.chinese}" ({body.pinyin}) ที่แปลว่า "{body.thai_meaning}"
ประโยคควรสั้น (5-12 ตัวอักษร) เหมาะสำหรับฝึกพูด ไม่ซ้ำกับตัวอย่างทั่วไป
ตอบเป็น JSON array เท่านั้น:
[{{"chinese":"...","pinyin":"...","thai":"..."}}]"""

    try:
        resp = _model.generate_content(prompt)
        text = _strip_markdown(_get_text(resp))
        sentences = json.loads(text)
        if not isinstance(sentences, list):
            raise ValueError
    except Exception:
        return [
            {"chinese": f"{body.chinese}很重要。", "pinyin": "", "thai": f"{body.chinese} สำคัญมาก"},
        ]

    # นับโควต้า gen — บันทึกลง record ล่าสุดของวันนี้
    if not is_premium:
        today_start = datetime.combine(date.today(), datetime.min.time())
        today_records = (
            db.query(SpeakingRecord)
            .filter(SpeakingRecord.user_id == current_user.id, SpeakingRecord.practiced_at >= today_start)
            .all()
        )
        if today_records:
            today_records[-1].daily_gen_count = (today_records[-1].daily_gen_count or 0) + 1
            db.commit()
        else:
            placeholder = SpeakingRecord(
                user_id=current_user.id,
                word_id=body.word_id,
                example_id=-2,
                example_chinese="",
                daily_gen_count=1,
            )
            db.add(placeholder)
            db.commit()

    return sentences[:3]


@router.get("/history")
def speaking_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    records = (
        db.query(SpeakingRecord)
        .filter(
            SpeakingRecord.user_id == current_user.id,
            SpeakingRecord.example_id != 0,        # ไม่แสดง placeholder เก่า
            SpeakingRecord.example_chinese != "",   # ไม่แสดง gen quota placeholder
        )
        .order_by(SpeakingRecord.practiced_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "word_id": r.word_id,
            "example_id": r.example_id,
            "example_chinese": r.example_chinese,
            "example_pinyin": r.example_pinyin,
            "is_generated": r.is_generated,
            "pronunciation_score": r.pronunciation_score,
            "tone_score": r.tone_score,
            "fluency_score": r.fluency_score,
            "practice_count": r.practice_count,
            "practiced_at": r.practiced_at,
            "word": {
                "chinese": r.word.chinese,
                "pinyin": r.word.pinyin,
                "thai_meaning": r.word.thai_meaning,
            } if r.word else None,
        }
        for r in records
    ]


@router.get("/daily-status")
def daily_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    is_admin = current_user.is_admin
    tier = "admin" if is_admin else _get_user_tier(current_user.id, db)
    month_count = 0 if is_admin else _month_speak_count(current_user.id, db)
    assess_limit = None if is_admin else MONTHLY_SPEAK_LIMITS.get(tier, 3)

    today_start = datetime.combine(date.today(), datetime.min.time())
    today_records = (
        db.query(SpeakingRecord)
        .filter(SpeakingRecord.user_id == current_user.id, SpeakingRecord.practiced_at >= today_start)
        .all()
    )
    today_gen = sum(r.daily_gen_count or 0 for r in today_records)

    return {
        "is_premium": tier != "free",
        "user_tier": tier,
        "today_assess": month_count,   # field name kept for frontend compat (now = month count)
        "today_gen": today_gen,
        "assess_limit": assess_limit,
        "gen_limit": None if is_admin else FREE_GEN_LIMIT,
        "can_practice": is_admin or assess_limit is None or month_count < assess_limit,
        "can_gen": is_admin or today_gen < FREE_GEN_LIMIT,
    }
