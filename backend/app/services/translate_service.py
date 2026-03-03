import json
import google.generativeai as genai
from ..config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-2.0-flash-lite")


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


def generate_daily_words(count: int, existing_chinese: set, category: str = None) -> list[dict]:
    """
    Ask Gemini to suggest `count` Chinese words.
    Returns list of {"chinese": "...", "category": "..."}
    """
    if not _has_api_key():
        return []
    try:
        existing_sample = '、'.join(list(existing_chinese)[:300])
        if category:
            cat_instruction = f'สร้างเฉพาะคำศัพท์หมวด "{category}" เท่านั้น'
            cat_field = f'"category":"{category}"'
        else:
            cat_instruction = (
                "Mix: daily life, food, travel, emotions, family, body, colors, time, "
                "numbers, verbs, adjectives. Avoid specialized medical/technical/legal terms."
            )
            cat_field = '"category":"<Thai category e.g. ทั่วไป อาหาร ครอบครัว>"'

        prompt = (
            f"Generate exactly {count} common Chinese words (simplified) for Thai learners.\n"
            f"{cat_instruction}\n"
            f"Do NOT include: {existing_sample}\n"
            "Return JSON array only, no explanation:\n"
            f'[{{"chinese":"你好",{cat_field}}},...]\n'
            "category must be a short Thai word."
        )
        response = _model.generate_content(prompt)
        data = json.loads(_strip_markdown(response.text))
        result = []
        for w in data:
            if isinstance(w, dict) and w.get("chinese"):
                chinese = w["chinese"].strip()
                if chinese and chinese not in existing_chinese:
                    result.append({"chinese": chinese, "category": w.get("category") or category or ""})
            elif isinstance(w, str) and w.strip() and w.strip() not in existing_chinese:
                result.append({"chinese": w.strip(), "category": category or ""})
        return result
    except Exception as e:
        raise RuntimeError(f"Gemini generate_daily_words failed: {e}") from e


def validate_word_exists(word: str, lang: str) -> bool:
    """ตรวจว่า word เป็นคำที่มีอยู่จริง ไม่ใช่พิมพ์ค้างหรือพิมพ์ผิด"""
    if not _has_api_key():
        return True
    try:
        if lang == "thai":
            prompt = (
                f'คำว่า "{word}" เป็นคำภาษาไทยที่มีอยู่จริงและมีความหมายหรือไม่? '
                "ตอบเฉพาะ yes หรือ no เท่านั้น"
            )
        elif lang == "chinese":
            prompt = f'Is "{word}" a valid Chinese word or phrase that exists in dictionaries? Answer only yes or no.'
        else:
            prompt = f'Is "{word}" a valid English word or common phrase? Answer only yes or no.'
        response = _model.generate_content(prompt)
        return response.text.strip().lower().startswith("yes")
    except Exception:
        return True  # fallback: assume valid


def generate_examples_for_word(chinese: str, pinyin: str, thai: str) -> list[dict]:
    """
    For each Thai meaning line, generate 3 examples:
      - daily_1: ชีวิตประจำวัน สถานการณ์ที่ 1
      - daily_2: ชีวิตประจำวัน สถานการณ์ที่ 2 (ต่างบริบทจาก daily_1)
      - written: ภาษาบทความ/หนังสือ
    Format: [{"meaning_line":0,"type":"daily_1","chinese":"...","pinyin":"...","thai":"..."}]
    """
    if not _has_api_key():
        return []
    try:
        meaning_lines = [l.strip() for l in thai.split('\n') if l.strip()]
        if not meaning_lines:
            meaning_lines = [thai.strip()]

        meanings_text = '\n'.join(
            f'{i+1}. {m}' for i, m in enumerate(meaning_lines)
        )
        prompt = (
            f'Chinese word: {chinese} ({pinyin})\n'
            f'Thai meanings:\n{meanings_text}\n\n'
            f'For EACH meaning above, generate 3 example sentences using "{chinese}":\n'
            '- type "daily_1": ประโยคชีวิตประจำวัน สถานการณ์ที่ 1 (สนทนาปกติ)\n'
            '- type "daily_2": ประโยคชีวิตประจำวัน สถานการณ์ที่ 2 (บริบทต่างจาก daily_1)\n'
            '- type "written": ประโยคภาษาทางการ สไตล์บทความ/หนังสือ/ข่าว\n\n'
            'Return ONLY a JSON array, no explanation, no markdown:\n'
            '[{"meaning_line":0,"type":"daily_1","chinese":"...","pinyin":"...","thai":"..."},'
            '{"meaning_line":0,"type":"daily_2","chinese":"...","pinyin":"...","thai":"..."},'
            '{"meaning_line":0,"type":"written","chinese":"...","pinyin":"...","thai":"..."},'
            '...repeat for each meaning line...]'
        )
        response = _model.generate_content(prompt)
        return json.loads(_strip_markdown(response.text))
    except Exception:
        return []
