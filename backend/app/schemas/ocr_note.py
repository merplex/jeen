from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class OcrNoteCreate(BaseModel):
    translation_text: str
    translation_mode: str = "general"
    lines_json: Optional[str] = None
    words_json: Optional[str] = None


class OcrNoteOut(BaseModel):
    id: int
    translation_text: str
    translation_mode: str
    lines_json: Optional[str] = None
    words_json: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
