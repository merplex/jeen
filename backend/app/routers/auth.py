import httpx
import random
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..auth import create_token
from ..config import settings

# OTP in-memory store: email → (otp, expires_at)
_otp_store: dict[str, tuple[str, datetime]] = {}

router = APIRouter(prefix="/auth", tags=["auth"])

LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize"
LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"
LINE_PROFILE_URL = "https://api.line.me/v2/profile"


@router.get("/line")
def line_login():
    """Redirect ไปหน้า LINE authorization"""
    if not settings.LINE_CHANNEL_ID:
        raise HTTPException(status_code=503, detail="LINE Login ยังไม่ได้ตั้งค่า")
    params = (
        f"response_type=code"
        f"&client_id={settings.LINE_CHANNEL_ID}"
        f"&redirect_uri={settings.LINE_CALLBACK_URL}"
        f"&scope=profile"
        f"&state=jeen_login"
    )
    return RedirectResponse(f"{LINE_AUTH_URL}?{params}")


@router.get("/line/callback")
def line_callback(code: str = None, state: str = None, error: str = None, db: Session = Depends(get_db)):
    """รับ code จาก LINE แล้วแลกเป็น user profile → JWT → redirect ไป frontend"""
    frontend = settings.FRONTEND_URL.rstrip("/")

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error=line_denied")

    # แลก code → access_token
    try:
        token_res = httpx.post(
            LINE_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.LINE_CALLBACK_URL,
                "client_id": settings.LINE_CHANNEL_ID,
                "client_secret": settings.LINE_CHANNEL_SECRET,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        token_res.raise_for_status()
        line_access_token = token_res.json()["access_token"]
    except Exception:
        return RedirectResponse(f"{frontend}/login?error=line_token_failed")

    # ดึง profile → ได้ userId
    try:
        profile_res = httpx.get(
            LINE_PROFILE_URL,
            headers={"Authorization": f"Bearer {line_access_token}"},
            timeout=10,
        )
        profile_res.raise_for_status()
        profile = profile_res.json()
        line_user_id = profile["userId"]          # เช่น Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        display_name = profile.get("displayName", "")
    except Exception:
        return RedirectResponse(f"{frontend}/login?error=line_profile_failed")

    # สร้างหรืออัปเดต user ใน DB
    is_admin = line_user_id in settings.admin_list
    user = db.query(User).filter(User.identifier == line_user_id).first()
    if not user:
        user = User(
            identifier=line_user_id,
            id_type="line",
            display_name=display_name,
            is_admin=is_admin,
        )
        db.add(user)
    else:
        # ยกระดับเป็น admin ได้ แต่ไม่ตัด admin ออกถ้าเคยเป็นอยู่แล้ว
        if is_admin:
            user.is_admin = True
        if display_name and not user.display_name:
            user.display_name = display_name
    db.commit()
    db.refresh(user)

    jwt_token = create_token(user.id)
    return RedirectResponse(f"{frontend}/line-callback?token={jwt_token}")


class EmailRequest(BaseModel):
    email: EmailStr


class OTPVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


def _send_otp_email(to_email: str, otp: str):
    """ส่ง OTP ผ่าน Resend HTTP API"""
    if not settings.RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="ระบบอีเมลยังไม่ได้ตั้งค่า (RESEND_API_KEY)")
    res = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
        json={
            "from": settings.EMAIL_FROM,
            "to": [to_email],
            "subject": f"รหัส OTP: {otp} — 字典",
            "text": (
                f"รหัส OTP ของคุณสำหรับเข้าสู่ระบบ 字典\n\n"
                f"รหัส: {otp}\n\n"
                f"รหัสนี้จะหมดอายุใน 10 นาที\n"
                f"ห้ามแจ้งรหัสนี้แก่ผู้อื่น"
            ),
        },
        timeout=10,
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"ส่งอีเมลไม่สำเร็จ: {res.text}")



@router.post("/email/request-otp")
def email_request_otp(body: EmailRequest):
    """ขอ OTP ทางอีเมล — ส่ง 6 หลัก หมดอายุ 10 นาที"""
    email = body.email.lower()
    otp = f"{random.randint(0, 999999):06d}"
    expires = datetime.utcnow() + timedelta(minutes=10)
    _otp_store[email] = (otp, expires)
    try:
        _send_otp_email(email, otp)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ส่งอีเมลไม่สำเร็จ: {e}")
    return {"ok": True, "message": "ส่ง OTP แล้ว กรุณาตรวจสอบอีเมลของคุณ"}


@router.post("/email/verify-otp")
def email_verify_otp(body: OTPVerifyRequest, db: Session = Depends(get_db)):
    """ตรวจสอบ OTP แล้วออก JWT"""
    email = body.email.lower()
    entry = _otp_store.get(email)
    if not entry:
        raise HTTPException(status_code=400, detail="ยังไม่ได้ขอ OTP หรือ OTP หมดอายุแล้ว")
    stored_otp, expires = entry
    if datetime.utcnow() > expires:
        del _otp_store[email]
        raise HTTPException(status_code=400, detail="OTP หมดอายุแล้ว กรุณาขอใหม่")
    if body.otp.strip() != stored_otp:
        raise HTTPException(status_code=400, detail="OTP ไม่ถูกต้อง")
    # OTP ถูก → ลบทิ้ง
    del _otp_store[email]
    # สร้างหรือดึง user
    user = db.query(User).filter(User.identifier == email).first()
    if not user:
        user = User(identifier=email, id_type="email", display_name="")
        db.add(user)
        db.commit()
        db.refresh(user)
    jwt_token = create_token(user.id)
    return {"token": jwt_token, "user": {"id": user.id, "display_name": user.display_name, "is_admin": user.is_admin}}


@router.get("/set-admin")
def set_admin(identifier: str, secret: str, db: Session = Depends(get_db)):
    """Set user เป็น admin โดยใช้ ADMIN_SECRET — ใช้ครั้งแรกตอน bootstrap เท่านั้น"""
    if not settings.ADMIN_SECRET or secret != settings.ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="secret ไม่ถูกต้อง")
    user = db.query(User).filter(User.identifier == identifier).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"ไม่พบ user '{identifier}' — กรุณา login ด้วย LINE ก่อน")
    user.is_admin = True
    db.commit()
    return {"ok": True, "identifier": identifier, "display_name": user.display_name}
