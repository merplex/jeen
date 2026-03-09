from datetime import datetime, timezone
from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from ..database import Base

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    deck = Column(Integer, nullable=False, default=1)  # 1, 2, 3
    added_at = Column(DateTime, default=_utcnow)

    user = relationship("User", back_populates="flashcards")
    word = relationship("Word", back_populates="flashcards")

    __table_args__ = (UniqueConstraint("user_id", "word_id", "deck", name="uq_flashcards_user_word_deck"),)
