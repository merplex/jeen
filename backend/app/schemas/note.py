from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from .word import WordOut


class NoteCreate(BaseModel):
    word_id: int
    note_text: str


class NoteUpdate(BaseModel):
    note_text: str


class NoteOut(BaseModel):
    id: int
    word_id: int
    note_text: str
    created_at: datetime
    updated_at: datetime
    word: Optional[WordOut] = None

    class Config:
        from_attributes = True
