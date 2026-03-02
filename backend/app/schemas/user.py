from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class UserLogin(BaseModel):
    identifier: str
    id_type: str  # 'email' | 'line' | 'phone'
    display_name: Optional[str] = None


class UserOut(BaseModel):
    id: int
    identifier: str
    id_type: Optional[str] = None
    display_name: Optional[str] = None
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
