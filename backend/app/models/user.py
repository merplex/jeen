from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, DateTime

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)
from sqlalchemy.orm import relationship
from ..database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    identifier = Column(String(100), unique=True, nullable=False)
    id_type = Column(String(20))
    display_name = Column(String(100))
    is_admin = Column(Boolean, default=False)
    report_flagged = Column(Boolean, default=False)
    password_hash = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    search_history = relationship("SearchHistory", back_populates="user")
    flashcards = relationship("Flashcard", back_populates="user")
    notes = relationship("UserNote", back_populates="user")
    subscriptions = relationship("UserSubscription", back_populates="user")
