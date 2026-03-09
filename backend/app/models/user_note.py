from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)


class UserNote(Base):
    __tablename__ = "user_notes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    note_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship("User", back_populates="notes")
    word = relationship("Word", back_populates="notes")
