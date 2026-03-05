from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class SpeakingRecord(Base):
    __tablename__ = "speaking_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    example_id = Column(Integer, nullable=False)          # Example.id ที่ฝึก
    example_chinese = Column(String(500), nullable=False) # เก็บข้อความไว้แสดงแม้ example ถูกลบ

    pronunciation_score = Column(Float, default=0)  # 0-100
    tone_score = Column(Float, default=0)           # 0-100
    fluency_score = Column(Float, default=0)        # 0-100

    practice_count = Column(Integer, default=1)
    practiced_at = Column(DateTime, default=func.now())

    user = relationship("User")
    word = relationship("Word")

    __table_args__ = (UniqueConstraint("user_id", "example_id", name="uq_speaking_user_example"),)
