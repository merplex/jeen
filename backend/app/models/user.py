from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from sqlalchemy.orm import relationship
from ..database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    identifier = Column(String(100), unique=True, nullable=False)
    id_type = Column(String(20))
    display_name = Column(String(100))
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    search_history = relationship("SearchHistory", back_populates="user")
    flashcards = relationship("Flashcard", back_populates="user")
    notes = relationship("UserNote", back_populates="user")
