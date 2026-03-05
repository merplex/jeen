from pydantic import BaseModel
from datetime import datetime
from .word import WordOut


class FlashcardOut(BaseModel):
    id: int
    word_id: int
    deck: int
    added_at: datetime
    word: WordOut

    class Config:
        from_attributes = True
