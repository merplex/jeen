from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from ..database import Base

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)


class WordReport(Base):
    __tablename__ = "word_reports"

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    message = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=_utcnow)
