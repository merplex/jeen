from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime
from ..database import Base

_utcnow = lambda: datetime.now(timezone.utc).replace(tzinfo=None)


class MissedSearch(Base):
    __tablename__ = "missed_searches"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String(200), unique=True, nullable=False)
    count = Column(Integer, default=1)
    last_searched_at = Column(DateTime, default=_utcnow)
    source = Column(String(20), nullable=False, default="search")  # "search" | "related"
