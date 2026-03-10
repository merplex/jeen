from pydantic import BaseModel
from .word import WordSearchOut


class PerCharGroup(BaseModel):
    char: str
    prefix_group: list[WordSearchOut] = []
    inner_group: list[WordSearchOut] = []


class SearchResult(BaseModel):
    prefix_group: list[WordSearchOut] = []
    inner_group: list[WordSearchOut] = []
    per_char_groups: list[PerCharGroup] = []
    search_mode: str = 'normal'  # 'normal' | 'position' | 'per_char'
    total: int = 0
    query: str
    found: bool = True
