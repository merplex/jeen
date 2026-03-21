from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from ..database import Base


class UserSubscription(Base):
    __tablename__ = "user_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # แหล่งที่มา
    platform = Column(String(20), nullable=False)  # "google" | "apple" | "manual" | "stripe"
    product_id = Column(String(100))               # เช่น "monthly_sub", "yearly_sub", "lifetime"
    purchase_type = Column(String(20), default="subscription")  # "subscription" | "one_time"

    # Token จาก store (ใช้ verify กับ Google/Apple API)
    purchase_token = Column(Text)

    # Status
    status = Column(String(20), nullable=False, default="active")
    # "active" | "cancelled" | "expired" | "pending" | "grace_period"

    expires_at = Column(DateTime, nullable=True)   # None = ไม่มีวันหมด (one-time)
    cancelled_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Admin note
    note = Column(String(500), nullable=True)

    user = relationship("User", back_populates="subscriptions")
