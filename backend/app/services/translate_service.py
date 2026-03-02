import json
import google.generativeai as genai
from ..config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-1.5-flash")


def generate_english_meaning(chinese: str, thai: str) -> str:
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
        return ""
    try:
        prompt = (
            f"Chinese word: {chinese}\n"
            f"Thai meaning: {thai}\n"
            "Give a concise English translation (1-5 words). Return only the English text, no explanation."
        )
        response = _model.generate_content(prompt)
        return response.text.strip()
    except Exception:
        return ""


def search_by_english(english_query: str) -> list[dict]:
    if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
        return []
    try:
        prompt = (
            f'User searched "{english_query}" in a Chinese-Thai dictionary.\n'
            'Return a JSON array (max 5 items) with the format:\n'
            '[{"chinese":"...","pinyin":"...","thai":"...","relevance":0.0}]\n'
            "Return valid JSON only, no explanation, no markdown."
        )
        response = _model.generate_content(prompt)
        text = response.text.strip()
        # strip markdown code block if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception:
        return []
