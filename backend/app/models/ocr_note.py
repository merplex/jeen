from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)


class OcrNote(Base):
    __tablename__ = "ocr_notes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    translation_text = Column(Text, nullable=False)
    translation_mode = Column(String(16), nullable=False, default="general")
    lines_json = Column(Text, nullable=True)  # JSON array of raw OCR lines [{text:"..."}]
    words_json = Column(Text, nullable=True)  # JSON array of {id,chinese,pinyin,thai_meaning}
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship("User", back_populates="ocr_notes")
