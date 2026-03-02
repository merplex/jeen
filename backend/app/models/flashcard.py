from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    added_at = Column(DateTime, default=func.now())

    user = relationship("User", back_populates="flashcards")
    word = relationship("Word", back_populates="flashcards")

    __table_args__ = (UniqueConstraint("user_id", "word_id"),)
