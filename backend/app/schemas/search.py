from pydantic import BaseModel
from .word import WordPublicOut


class SearchResult(BaseModel):
    prefix_group: list[WordPublicOut] = []
    inner_group: list[WordPublicOut] = []
    total: int = 0
    query: str
    found: bool = True
