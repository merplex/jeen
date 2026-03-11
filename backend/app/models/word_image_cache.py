from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, func
from ..database import Base


class WordImageCache(Base):
    __tablename__ = "word_image_cache"

    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), primary_key=True)
    image_url = Column(Text, nullable=True)  # None = ไม่มีรูปที่เหมาะสม
    cached_at = Column(DateTime, default=func.now())
