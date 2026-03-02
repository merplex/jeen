from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func, Index
from sqlalchemy.orm import relationship
from ..database import Base


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    query = Column(String(200), nullable=False)
    result_word_id = Column(Integer, ForeignKey("words.id"))
    found = Column(Boolean, default=True)
    searched_at = Column(DateTime, default=func.now())

    user = relationship("User", back_populates="search_history")

    __table_args__ = (
        Index("idx_history_user_time", "user_id", "searched_at"),
    )
