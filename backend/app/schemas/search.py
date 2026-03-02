from pydantic import BaseModel
from typing import Optional
from .word import WordOut


class SearchResult(BaseModel):
    prefix_group: list[WordOut] = []
    inner_group: list[WordOut] = []
    total: int = 0
    query: str
    found: bool = True
