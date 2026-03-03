from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime
import re


class UserLogin(BaseModel):
    identifier: str
    id_type: Literal['email', 'line']
    display_name: Optional[str] = None

    @field_validator('identifier')
    @classmethod
    def validate_identifier(cls, v, info):
        id_type = info.data.get('id_type')
        v = v.strip()
        if id_type == 'email':
            if not re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
                raise ValueError('รูปแบบอีเมลไม่ถูกต้อง')
        elif id_type == 'line':
            if not re.match(r'^U[0-9a-fA-F]{10,}$', v):
                raise ValueError('Line User ID ต้องขึ้นต้นด้วย U ตามด้วยตัวเลข/ตัวอักษร เช่น Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
        return v


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
