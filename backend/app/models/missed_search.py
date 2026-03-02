from sqlalchemy import Column, Integer, String, DateTime, func
from ..database import Base


class MissedSearch(Base):
    __tablename__ = "missed_searches"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String(200), unique=True, nullable=False)
    count = Column(Integer, default=1)
    last_searched_at = Column(DateTime, default=func.now())
