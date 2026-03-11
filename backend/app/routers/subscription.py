"""
Subscription management router
- GET  /subscription/status          → ดู status ของ user ปัจจุบัน
- POST /subscription/verify          → verify purchase token จาก Google/Apple
- POST /webhooks/google-play         → รับ real-time notification จาก Google
- POST /webhooks/apple               → รับ notification จาก Apple
- POST /admin/subscription/grant     → admin มอบ subscription ให้ user
- GET  /admin/subscription/list      → admin ดูรายการทั้งหมด
"""

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from ..auth import require_admin, require_user
from ..config import settings
from ..database import get_db
from ..models.subscription import UserSubscription
from ..models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["subscription"])


# ─── helpers ────────────────────────────────────────────────────────────────

def _get_active_sub(db: Session, user_id: int) -> Optional[UserSubscription]:
    """คืน subscription ที่ active อยู่ล่าสุด หรือ None"""
    now = datetime.now(timezone.utc)
    subs = (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user_id,
            UserSubscription.status == "active",
        )
        .order_by(UserSubscription.created_at.desc())
        .all()
    )
    for sub in subs:
        # one-time หรือ manual ที่ไม่มีวันหมด = active ตลอด
        if sub.expires_at is None:
            return sub
        expires = sub.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires > now:
            return sub
        # หมดอายุแล้ว → อัปเดต status
        sub.status = "expired"
        db.commit()
    return None


def _sub_to_dict(sub: Optional[UserSubscription]) -> dict:
    if sub is None:
        return {
            "active": False,
            "plan": None,
            "platform": None,
            "purchase_type": None,
            "expires_at": None,
        }
    return {
        "active": True,
        "plan": sub.product_id,
        "platform": sub.platform,
        "purchase_type": sub.purchase_type,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }


# ─── user endpoints ──────────────────────────────────────────────────────────

@router.get("/subscription/status")
def get_subscription_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """ดู subscription status ของ user ที่ login อยู่"""
    sub = _get_active_sub(db, current_user.id)
    result = _sub_to_dict(sub)
    result["tier"] = current_user.tier
    return result


class VerifyPurchaseRequest(BaseModel):
    platform: str          # "google" | "apple"
    product_id: str
    purchase_token: str
    purchase_type: str = "subscription"  # "subscription" | "one_time"


@router.post("/subscription/verify")
def verify_purchase(
    body: VerifyPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """
    รับ purchase token จาก mobile app แล้ว verify กับ Google/Apple API
    ถ้า verify ผ่าน → บันทึก subscription ใน DB
    """
    if body.platform == "google":
        result = _verify_google(body.product_id, body.purchase_token, body.purchase_type)
    elif body.platform == "apple":
        result = _verify_apple(body.purchase_token)
    else:
        raise HTTPException(status_code=400, detail="platform ต้องเป็น 'google' หรือ 'apple'")

    if not result["valid"]:
        raise HTTPException(status_code=400, detail=f"ยืนยันการซื้อไม่ผ่าน: {result.get('reason', '')}")

    sub = UserSubscription(
        user_id=current_user.id,
        platform=body.platform,
        product_id=body.product_id,
        purchase_type=body.purchase_type,
        purchase_token=body.purchase_token,
        status="active",
        expires_at=result.get("expires_at"),
    )
    db.add(sub)
    # one_time purchase = lifetime tier
    if body.purchase_type == "one_time":
        current_user.tier = "lifetime"
    db.commit()
    db.refresh(sub)
    return _sub_to_dict(sub)


# ─── Google Play verification ────────────────────────────────────────────────

def _verify_google(product_id: str, purchase_token: str, purchase_type: str) -> dict:
    """
    ตรวจสอบกับ Google Play Developer API
    ต้องมี GOOGLE_SERVICE_ACCOUNT_JSON ใน settings
    """
    package = getattr(settings, "GOOGLE_PLAY_PACKAGE", None)
    sa_json = getattr(settings, "GOOGLE_SERVICE_ACCOUNT_JSON", None)

    if not package or not sa_json:
        logger.warning("GOOGLE_PLAY_PACKAGE หรือ GOOGLE_SERVICE_ACCOUNT_JSON ยังไม่ได้ตั้งค่า")
        return {"valid": False, "reason": "Google Play ยังไม่ได้ตั้งค่า"}

    try:
        access_token = _get_google_access_token(sa_json)
        if purchase_type == "subscription":
            url = (
                f"https://androidpublisher.googleapis.com/androidpublisher/v3"
                f"/applications/{package}/purchases/subscriptions"
                f"/{product_id}/tokens/{purchase_token}"
            )
        else:
            url = (
                f"https://androidpublisher.googleapis.com/androidpublisher/v3"
                f"/applications/{package}/purchases/products"
                f"/{product_id}/tokens/{purchase_token}"
            )

        res = httpx.get(url, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
        res.raise_for_status()
        data = res.json()

        if purchase_type == "subscription":
            expiry_ms = int(data.get("expiryTimeMillis", 0))
            expires_at = datetime.fromtimestamp(expiry_ms / 1000, tz=timezone.utc) if expiry_ms else None
            cancel_reason = data.get("cancelReason")
            if cancel_reason is not None:
                return {"valid": False, "reason": f"cancelled (reason={cancel_reason})"}
            return {"valid": True, "expires_at": expires_at}
        else:
            purchase_state = data.get("purchaseState", 1)
            if purchase_state != 0:  # 0 = purchased
                return {"valid": False, "reason": "purchase not completed"}
            return {"valid": True, "expires_at": None}

    except Exception as e:
        logger.error(f"Google verify error: {e}")
        return {"valid": False, "reason": str(e)}


def _get_google_access_token(sa_json: str) -> str:
    """สร้าง OAuth2 access token จาก service account JSON"""
    import time
    import json as json_lib
    from jose import jwt as jose_jwt

    sa = json_lib.loads(sa_json)
    now = int(time.time())
    claim = {
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/androidpublisher",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }
    signed = jose_jwt.encode(claim, sa["private_key"], algorithm="RS256")
    res = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={"grant_type": "urn:ietf:params:oauth2:grant-type:jwt-bearer", "assertion": signed},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()["access_token"]


# ─── Apple App Store verification ────────────────────────────────────────────

def _verify_apple(receipt_data: str) -> dict:
    """
    ตรวจสอบกับ Apple App Store Server API
    ต้องมี APPLE_SHARED_SECRET ใน settings
    """
    shared_secret = getattr(settings, "APPLE_SHARED_SECRET", None)
    if not shared_secret:
        logger.warning("APPLE_SHARED_SECRET ยังไม่ได้ตั้งค่า")
        return {"valid": False, "reason": "Apple App Store ยังไม่ได้ตั้งค่า"}

    try:
        payload = {"receipt-data": receipt_data, "password": shared_secret}
        # ลอง production ก่อน
        res = httpx.post("https://buy.itunes.apple.com/verifyReceipt", json=payload, timeout=10)
        data = res.json()

        # status 21007 = sandbox receipt ส่งมาที่ production → ลอง sandbox
        if data.get("status") == 21007:
            res = httpx.post("https://sandbox.itunes.apple.com/verifyReceipt", json=payload, timeout=10)
            data = res.json()

        if data.get("status") != 0:
            return {"valid": False, "reason": f"Apple status={data.get('status')}"}

        receipts = data.get("latest_receipt_info", [])
        if not receipts:
            return {"valid": False, "reason": "ไม่พบ receipt"}

        latest = sorted(receipts, key=lambda r: int(r.get("expires_date_ms", 0)), reverse=True)[0]
        expires_ms = int(latest.get("expires_date_ms", 0))
        expires_at = datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc) if expires_ms else None
        cancel_date = latest.get("cancellation_date_ms")
        if cancel_date:
            return {"valid": False, "reason": "subscription cancelled"}

        return {"valid": True, "expires_at": expires_at}

    except Exception as e:
        logger.error(f"Apple verify error: {e}")
        return {"valid": False, "reason": str(e)}


# ─── Webhooks ─────────────────────────────────────────────────────────────────

@router.post("/webhooks/google-play")
async def google_play_webhook(request: Request, db: Session = Depends(get_db)):
    """
    รับ Real-time Developer Notifications จาก Google Play (Pub/Sub)
    https://developer.android.com/google/play/billing/rtdn-reference
    """
    body = await request.json()
    try:
        import base64
        message = body.get("message", {})
        data_b64 = message.get("data", "")
        notification = json.loads(base64.b64decode(data_b64).decode("utf-8"))
        logger.info(f"Google Play webhook: {notification}")

        sub_notification = notification.get("subscriptionNotification", {})
        notif_type = sub_notification.get("notificationType")
        purchase_token = sub_notification.get("purchaseToken")

        if not purchase_token:
            return {"ok": True}

        sub = (
            db.query(UserSubscription)
            .filter(UserSubscription.purchase_token == purchase_token)
            .first()
        )
        if not sub:
            return {"ok": True}

        # https://developer.android.com/google/play/billing/rtdn-reference#sub
        CANCELLED_TYPES = {3, 13}   # SUBSCRIPTION_CANCELED, SUBSCRIPTION_EXPIRED
        REVOKED_TYPES = {12}        # SUBSCRIPTION_REVOKED
        if notif_type in CANCELLED_TYPES:
            sub.status = "cancelled"
            sub.cancelled_at = datetime.now(timezone.utc)
        elif notif_type in REVOKED_TYPES:
            sub.status = "expired"
        elif notif_type == 4:       # SUBSCRIPTION_RENEWED
            sub.status = "active"
        db.commit()
    except Exception as e:
        logger.error(f"Google webhook error: {e}")

    return {"ok": True}


@router.post("/webhooks/apple")
async def apple_webhook(request: Request, db: Session = Depends(get_db)):
    """
    รับ App Store Server Notifications จาก Apple
    https://developer.apple.com/documentation/appstoreservernotifications
    """
    body = await request.json()
    try:
        logger.info(f"Apple webhook: {body}")
        notif_type = body.get("notificationType")  # "CANCEL", "DID_RENEW", etc.
        unified_receipt = body.get("unified_receipt", {})
        latest_info = unified_receipt.get("latest_receipt_info", [{}])
        if not latest_info:
            return {"ok": True}

        latest = latest_info[-1]
        original_txn = latest.get("original_transaction_id")

        sub = (
            db.query(UserSubscription)
            .filter(UserSubscription.purchase_token == original_txn)
            .first()
        )
        if not sub:
            return {"ok": True}

        if notif_type in ("CANCEL", "DID_FAIL_TO_RENEW", "EXPIRED"):
            sub.status = "cancelled" if notif_type == "CANCEL" else "expired"
            sub.cancelled_at = datetime.now(timezone.utc)
        elif notif_type in ("DID_RENEW", "INITIAL_BUY"):
            sub.status = "active"
            expires_ms = int(latest.get("expires_date_ms", 0))
            if expires_ms:
                sub.expires_at = datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc)
        db.commit()
    except Exception as e:
        logger.error(f"Apple webhook error: {e}")

    return {"ok": True}


# ─── Admin endpoints ──────────────────────────────────────────────────────────

class GrantSubscriptionRequest(BaseModel):
    user_id: int
    platform: str = "manual"
    product_id: str = "manual_grant"
    purchase_type: str = "subscription"  # "subscription" | "one_time"
    expires_at: Optional[str] = None     # ISO datetime string หรือ None = ไม่มีวันหมด
    note: Optional[str] = None


@router.post("/admin/subscription/grant")
def admin_grant_subscription(
    body: GrantSubscriptionRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin มอบ subscription ให้ user โดยตรง"""
    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบ user")

    expires_at = None
    if body.expires_at:
        expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))

    sub = UserSubscription(
        user_id=body.user_id,
        platform=body.platform,
        product_id=body.product_id,
        purchase_type=body.purchase_type,
        status="active",
        expires_at=expires_at,
        note=body.note,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return {"ok": True, "subscription_id": sub.id}


@router.get("/admin/subscription/list")
def admin_list_subscriptions(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin ดูรายการ subscription ทั้งหมด"""
    subs = (
        db.query(UserSubscription)
        .order_by(UserSubscription.created_at.desc())
        .limit(500)
        .all()
    )
    return [
        {
            "id": s.id,
            "user_id": s.user_id,
            "platform": s.platform,
            "product_id": s.product_id,
            "purchase_type": s.purchase_type,
            "status": s.status,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "cancelled_at": s.cancelled_at.isoformat() if s.cancelled_at else None,
            "created_at": s.created_at.isoformat(),
            "note": s.note,
        }
        for s in subs
    ]


@router.patch("/admin/subscription/{sub_id}/cancel")
def admin_cancel_subscription(
    sub_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin ยกเลิก subscription"""
    sub = db.query(UserSubscription).filter(UserSubscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="ไม่พบ subscription")
    sub.status = "cancelled"
    sub.cancelled_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


# ─── Tier management ──────────────────────────────────────────────────────────

VALID_TIERS = {"reduser", "learner", "lifetime", "superuser"}


class SetTierRequest(BaseModel):
    identifier: str   # email หรือ LINE user ID
    tier: str         # "reduser" | "learner" | "lifetime" | "superuser"
    note: Optional[str] = None


@router.post("/admin/users/set-tier")
def admin_set_user_tier(
    body: SetTierRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin กำหนด tier ให้ user ค้นหาจาก email หรือ LINE ID"""
    if body.tier not in VALID_TIERS:
        raise HTTPException(status_code=400, detail=f"tier ต้องเป็น {VALID_TIERS}")

    user = db.query(User).filter(User.identifier == body.identifier.strip()).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบ user")

    user.tier = body.tier
    db.commit()
    return {
        "ok": True,
        "user_id": user.id,
        "display_name": user.display_name,
        "identifier": user.identifier,
        "tier": user.tier,
    }


@router.get("/admin/users/tiered")
def admin_list_tiered_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin ดูรายชื่อ user ที่มี tier ไม่ใช่ reduser (manually managed)"""
    users = (
        db.query(User)
        .filter(User.tier != "reduser")
        .order_by(User.id.desc())
        .all()
    )
    return [
        {
            "id": u.id,
            "identifier": u.identifier,
            "id_type": u.id_type,
            "display_name": u.display_name,
            "tier": u.tier,
            "is_admin": u.is_admin,
        }
        for u in users
    ]
