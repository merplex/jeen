import json
import google.generativeai as genai
from ..config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-1.5-flash")


def _has_api_key() -> bool:
    return bool(settings.GEMINI_API_KEY) and settings.GEMINI_API_KEY != "your_gemini_api_key_here"


def _strip_markdown(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def generate_english_meaning(chinese: str, thai: str) -> str:
    if not _has_api_key():
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
    if not _has_api_key():
        return []
    try:
        prompt = (
            f'User searched "{english_query}" in a Chinese-Thai dictionary.\n'
            'Return a JSON array (max 5 items) with the format:\n'
            '[{"chinese":"...","pinyin":"...","thai":"...","relevance":0.0}]\n'
            "Return valid JSON only, no explanation, no markdown."
        )
        response = _model.generate_content(prompt)
        return json.loads(_strip_markdown(response.text))
    except Exception:
        return []


def batch_generate_metadata(words: list[dict]) -> list[dict]:
    """
    รับ [{"id": x, "chinese": "...", "thai": "..."}]
    คืน [{"id": x, "english": "...", "category": "..."}]
    """
    if not _has_api_key() or not words:
        return []
    try:
        items = "\n".join(
            f'{i+1}. id={w["id"]} chinese={w["chinese"]} thai={w.get("thai","")}'
            for i, w in enumerate(words)
        )
        prompt = (
            "For each Chinese-Thai word pair below, provide English translation and category.\n"
            "Category must be one of: noun, verb, adjective, adverb, phrase, particle, other\n"
            f"{items}\n\n"
            "Return a JSON array only, no explanation, no markdown:\n"
            '[{"id":1,"english":"...","category":"..."},...]'
        )
        response = _model.generate_content(prompt)
        return json.loads(_strip_markdown(response.text))
    except Exception:
        return []


def generate_daily_words(count: int, existing_chinese: set) -> list[str]:
    """
    Ask Gemini to suggest `count` common Chinese words not in existing_chinese.
    Returns list of Chinese characters.
    """
    if not _has_api_key():
        return []
    try:
        existing_sample = '、'.join(list(existing_chinese)[:300])
        prompt = (
            f"Generate exactly {count} common Chinese words (simplified characters) for Thai learners.\n"
            "Focus on HSK 1-4 vocabulary. Mix categories: daily life, food, travel, work, "
            "emotions, nature, time, family, body, colors, numbers, verbs, adjectives.\n"
            f"These words already exist — do NOT include them: {existing_sample}\n"
            "Return a JSON array of Chinese characters only, no pinyin, no explanation:\n"
            '["你好","谢谢","再见",...]'
        )
        response = _model.generate_content(prompt)
        data = json.loads(_strip_markdown(response.text))
        return [w for w in data if isinstance(w, str) and w.strip() and w not in existing_chinese]
    except Exception:
        return []


def generate_examples_for_word(chinese: str, pinyin: str, thai: str) -> list[dict]:
    """
    คืน 3 ประโยคตัวอย่าง: common, formal, spoken
    Format: [{"type":"common","chinese":"...","pinyin":"...","thai":"..."}]
    """
    if not _has_api_key():
        return []
    try:
        prompt = (
            f'Chinese word: {chinese} ({pinyin}) — Thai: {thai}\n'
            "Generate 3 example sentences using this word:\n"
            "1. type=common (everyday usage)\n"
            "2. type=formal (formal/written)\n"
            "3. type=spoken (casual spoken)\n\n"
            "Return valid JSON only, no explanation, no markdown:\n"
            '[{"type":"common","chinese":"...","pinyin":"...","thai":"..."},'
            '{"type":"formal","chinese":"...","pinyin":"...","thai":"..."},'
            '{"type":"spoken","chinese":"...","pinyin":"...","thai":"..."}]'
        )
        response = _model.generate_content(prompt)
        return json.loads(_strip_markdown(response.text))
    except Exception:
        return []
