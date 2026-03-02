from sqlalchemy import Column, Integer, String, Text, SmallInteger, Computed, DateTime, func
from sqlalchemy.orm import relationship
from ..database import Base


class Word(Base):
    __tablename__ = "words"

    id = Column(Integer, primary_key=True, index=True)
    chinese = Column(String(50), nullable=False, index=True)
    pinyin = Column(String(100), nullable=False)
    pinyin_plain = Column(String(100), index=True)
    thai_meaning = Column(Text, nullable=False, index=True)
    english_meaning = Column(Text, index=True)
    category = Column(String(50))
    char_count = Column(SmallInteger, Computed("LENGTH(chinese)"), index=True)
    status = Column(String(20), default="verified")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    examples = relationship("Example", back_populates="word", cascade="all, delete-orphan")
    flashcards = relationship("Flashcard", back_populates="word")
    notes = relationship("UserNote", back_populates="word")


class WordPending(Base):
    __tablename__ = "words_pending"

    id = Column(Integer, primary_key=True, index=True)
    chinese = Column(String(50), nullable=False)
    pinyin = Column(String(100))
    pinyin_plain = Column(String(100))
    thai_meaning = Column(Text)
    english_meaning = Column(Text)
    category = Column(String(50))
    source = Column(String(100))
    created_at = Column(DateTime, default=func.now())
