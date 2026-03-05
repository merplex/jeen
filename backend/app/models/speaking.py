from sqlalchemy import Column, Integer, Float, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship
from ..database import Base


class SpeakingRecord(Base):
    __tablename__ = "speaking_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    word_id = Column(Integer, ForeignKey("words.id"), nullable=False)
    example_id = Column(Integer, nullable=False)          # Example.id ที่ฝึก (negative = generated)
    example_chinese = Column(String(500), nullable=False) # เก็บข้อความไว้แสดงแม้ example ถูกลบ
    example_pinyin = Column(String(500), nullable=True)   # pinyin ของประโยค
    is_generated = Column(Boolean, default=False)         # True = gen จาก Gemini

    pronunciation_score = Column(Float, default=0)  # 0-100
    tone_score = Column(Float, default=0)           # 0-100
    fluency_score = Column(Float, default=0)        # 0-100

    practice_count = Column(Integer, default=1)
    daily_assess_count = Column(Integer, default=0)  # จำนวนครั้ง assess วันนี้ (reset ทุกวันโดย logic)
    daily_gen_count = Column(Integer, default=0)     # จำนวนครั้ง gen ประโยควันนี้
    practiced_at = Column(DateTime, default=func.now())

    user = relationship("User")
    word = relationship("Word")

    __table_args__ = (UniqueConstraint("user_id", "example_id", name="uq_speaking_user_example"),)
