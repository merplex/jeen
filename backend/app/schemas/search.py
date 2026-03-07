from pydantic import BaseModel
from .word import WordPublicOut


class PerCharGroup(BaseModel):
    char: str
    prefix_group: list[WordPublicOut] = []
    inner_group: list[WordPublicOut] = []


class SearchResult(BaseModel):
    prefix_group: list[WordPublicOut] = []
    inner_group: list[WordPublicOut] = []
    per_char_groups: list[PerCharGroup] = []
    search_mode: str = 'normal'  # 'normal' | 'position' | 'per_char'
    total: int = 0
    query: str
    found: bool = True
