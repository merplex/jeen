from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str
    GEMINI_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ADMIN_IDENTIFIERS: str = ""
    JWT_SECRET: str = "changeme"
    JWT_EXPIRE_HOURS: int = 720
    FRONTEND_URL: str = "http://localhost:3000"
    LINE_CHANNEL_ID: str = ""
    LINE_CHANNEL_SECRET: str = ""
    LINE_CALLBACK_URL: str = "http://localhost:8000/auth/line/callback"
    ADMIN_SECRET: str = ""
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "noreply@neverjod.com"

    # Image APIs
    SPOONACULAR_API_KEY: str = ""
    GOOGLE_PLACES_API_KEY: str = ""
    SHOWAPI_API_KEY: str = ""
    SHOWAPI_ENDPOINT: str = ""

    # Subscription / IAP
    GOOGLE_PLAY_PACKAGE: str = ""          # เช่น "com.yourapp.dict"
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""  # JSON string ของ service account
    APPLE_SHARED_SECRET: str = ""          # App Store shared secret

    @property
    def admin_list(self) -> List[str]:
        return [x.strip() for x in self.ADMIN_IDENTIFIERS.split(",") if x.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
