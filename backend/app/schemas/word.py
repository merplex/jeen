from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ExampleOut(BaseModel):
    id: int
    chinese: str
    pinyin: Optional[str] = None
    thai: Optional[str] = None
    type: Optional[str] = None
    sort_order: Optional[int] = None

    class Config:
        from_attributes = True


class WordOut(BaseModel):
    id: int
    chinese: str
    pinyin: str
    pinyin_plain: Optional[str] = None
    thai_meaning: str
    english_meaning: Optional[str] = None
    category: Optional[str] = None
    char_count: Optional[int] = None
    status: str
    examples: list[ExampleOut] = []

    class Config:
        from_attributes = True


class WordCreate(BaseModel):
    chinese: str
    pinyin: str
    pinyin_plain: Optional[str] = None
    thai_meaning: str
    english_meaning: Optional[str] = None
    category: Optional[str] = None


class WordUpdate(BaseModel):
    chinese: Optional[str] = None
    pinyin: Optional[str] = None
    pinyin_plain: Optional[str] = None
    thai_meaning: Optional[str] = None
    english_meaning: Optional[str] = None
    category: Optional[str] = None


class WordPendingOut(BaseModel):
    id: int
    chinese: str
    pinyin: Optional[str] = None
    thai_meaning: Optional[str] = None
    english_meaning: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class WordPendingCreate(BaseModel):
    chinese: str
    pinyin: Optional[str] = None
    thai_meaning: Optional[str] = None
    english_meaning: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = "manual"
