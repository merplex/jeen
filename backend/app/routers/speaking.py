import os
import base64
import json
import httpx
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.speaking import SpeakingRecord
from ..models.subscription import UserSubscription
from ..models.user import User
from ..auth import require_user

router = APIRouter(prefix="/speaking", tags=["speaking"])

FREE_DAILY_LIMIT = 1


def _has_subscription(user_id: int, db: Session) -> bool:
    sub = (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user_id,
            UserSubscription.status == "active",
        )
        .first()
    )
    if not sub:
        return False
    if sub.expires_at and sub.expires_at < datetime.utcnow():
        return False
    return True


def _today_count(user_id: int, db: Session) -> int:
    today_start = datetime.combine(date.today(), datetime.min.time())
    return (
        db.query(SpeakingRecord)
        .filter(
            SpeakingRecord.user_id == user_id,
            SpeakingRecord.practiced_at >= today_start,
        )
        .count()
    )


async def _assess_azure(audio_base64: str, reference_text: str) -> dict:
    """เรียก Azure Pronunciation Assessment — ต้องมี AZURE_SPEECH_KEY และ AZURE_SPEECH_REGION"""
    key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")
    if not key or not region:
        return None  # fallback to mock

    pronunciation_config = json.dumps({
        "referenceText": reference_text,
        "gradingSystem": "HundredMark",
        "granularity": "Word",
        "enableMiscue": True,
    })
    config_b64 = base64.b64encode(pronunciation_config.encode()).decode()

    url = f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
    params = {"language": "zh-CN", "format": "detailed"}
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
        "Pronunciation-Assessment": config_b64,
    }
    audio_bytes = base64.b64decode(audio_base64)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, params=params, headers=headers, content=audio_bytes)
        if resp.status_code != 200:
            return None
        data = resp.json()

    pa = data.get("NBest", [{}])[0].get("PronunciationAssessment", {})
    return {
        "pronunciation_score": pa.get("AccuracyScore", 0),
        "tone_score": pa.get("ProsodyScore", 0),
        "fluency_score": pa.get("FluencyScore", 0),
    }


class AssessRequest(BaseModel):
    word_id: int
    example_id: int
    example_chinese: str
    audio_base64: str  # WAV audio encoded as base64


@router.post("/assess")
async def assess_speaking(
    body: AssessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    is_premium = current_user.is_admin or _has_subscription(current_user.id, db)
    if not is_premium:
        today = _today_count(current_user.id, db)
        if today >= FREE_DAILY_LIMIT:
            raise HTTPException(
                status_code=403,
                detail=f"ใช้ฟรีได้ {FREE_DAILY_LIMIT} ครั้ง/วัน — อัปเกรดเพื่อไม่จำกัด",
            )

    scores = await _assess_azure(body.audio_base64, body.example_chinese)
    if scores is None:
        # Azure ไม่ได้ตั้งค่า — คืน mock (dev mode)
        import random
        scores = {
            "pronunciation_score": round(random.uniform(40, 95), 1),
            "tone_score": round(random.uniform(30, 90), 1),
            "fluency_score": round(random.uniform(35, 92), 1),
        }

    new_total = scores["pronunciation_score"] + scores["tone_score"] + scores["fluency_score"]

    # Upsert: ถ้า score ดีขึ้นจะอัปเดต
    existing = db.query(SpeakingRecord).filter(
        SpeakingRecord.user_id == current_user.id,
        SpeakingRecord.example_id == body.example_id,
    ).first()

    is_improved = False
    if existing:
        old_total = existing.pronunciation_score + existing.tone_score + existing.fluency_score
        existing.practice_count += 1
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
            **scores,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        is_improved = True

    return {**scores, "is_improved": is_improved}


@router.get("/history")
def speaking_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    records = (
        db.query(SpeakingRecord)
        .filter(SpeakingRecord.user_id == current_user.id)
        .order_by(SpeakingRecord.practiced_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "word_id": r.word_id,
            "example_id": r.example_id,
            "example_chinese": r.example_chinese,
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
    is_premium = current_user.is_admin or _has_subscription(current_user.id, db)
    today = _today_count(current_user.id, db)
    return {
        "is_premium": is_premium,
        "today_count": today,
        "daily_limit": None if is_premium else FREE_DAILY_LIMIT,
        "can_practice": is_premium or today < FREE_DAILY_LIMIT,
    }
