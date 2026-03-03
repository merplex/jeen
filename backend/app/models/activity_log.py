from sqlalchemy import Column, Integer, String, Text, DateTime, func
from ..database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(50), nullable=False)  # word_added, example_added, example_deleted, bulk_english, bulk_examples
    word_id = Column(Integer, nullable=True)
    chinese = Column(String(50), nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
