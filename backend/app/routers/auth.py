import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..auth import create_token
from ..config import settings

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
        user.is_admin = is_admin
        if display_name and not user.display_name:
            user.display_name = display_name
    db.commit()
    db.refresh(user)

    jwt_token = create_token(user.id)
    return RedirectResponse(f"{frontend}/line-callback?token={jwt_token}")


@router.post("/set-admin")
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
