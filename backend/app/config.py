from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str
    GEMINI_API_KEY: str = ""
    ADMIN_IDENTIFIERS: str = ""
    JWT_SECRET: str = "changeme"
    JWT_EXPIRE_HOURS: int = 720

    @property
    def admin_list(self) -> List[str]:
        return [x.strip() for x in self.ADMIN_IDENTIFIERS.split(",") if x.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
