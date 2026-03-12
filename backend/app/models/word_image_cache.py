from sqlalchemy import Column, Integer, Text, DateTime, LargeBinary, String, ForeignKey, func
from ..database import Base


class WordImageCache(Base):
    __tablename__ = "word_image_cache"

    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), primary_key=True)
    image_url = Column(Text, nullable=True)          # fallback URL ถ้า download ไม่ได้
    image_data = Column(LargeBinary, nullable=True)  # binary image ที่ download เก็บไว้
    image_source = Column(String(32), nullable=True) # 'google_places' | 'spoonacular' | 'wikipedia'
    cached_at = Column(DateTime, default=func.now())
    last_accessed_at = Column(DateTime, default=func.now(), onupdate=func.now())
