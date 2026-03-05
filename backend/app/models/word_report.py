from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from ..database import Base


class WordReport(Base):
    __tablename__ = "word_reports"

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    message = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=func.now())
