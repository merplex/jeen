from sqlalchemy import Column, Integer, String, Text, SmallInteger, ForeignKey
from sqlalchemy.orm import relationship
from ..database import Base


class Example(Base):
    __tablename__ = "examples"

    id = Column(Integer, primary_key=True, index=True)
    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False)
    chinese = Column(Text, nullable=False)
    pinyin = Column(Text)
    thai = Column(Text)
    type = Column(String(20))
    sort_order = Column(SmallInteger)

    word = relationship("Word", back_populates="examples")
