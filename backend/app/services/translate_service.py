import json
import google.generativeai as genai
from ..config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)
_model = genai.GenerativeModel("gemini-2.5-flash")


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


def batch_generate_english(words: list[dict]) -> list[dict]:
    """
    รับ [{"id": x, "chinese": "...", "thai": "..."}]
    คืน [{"id": x, "english": "all, english, meanings"}]
    — ใส่ทุก meaning ที่เป็นไปได้ คั่นด้วย comma
    """
    if not _has_api_key() or not words:
        return []
    try:
        items = "\n".join(
            f'id={w["id"]} chinese={w["chinese"]} thai={w.get("thai","")}'
            for w in words
        )
        prompt = (
            "For each Chinese word below, list ALL common English translations (comma-separated).\n"
            "Be comprehensive — include every meaning the word can have.\n"
            "IMPORTANT: In your response, keep the exact numeric 'id' value from the input.\n"
            "Example: id=1042 chinese=出口 thai=ทางออก → {\"id\":1042,\"english\":\"exit, export, way out\"}\n"
            f"{items}\n\n"
            "Return a JSON array only, no explanation, no markdown:\n"
            '[{"id":<exact id from input>,"english":"meaning1, meaning2"},...]'
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


def generate_daily_words(count: int, existing_chinese: set, category: str = None, keyword: str = None) -> list[dict]:
    """
    Ask Gemini to suggest `count` Chinese words.
    Returns list of {"chinese": "...", "category": "..."}
    """
    if not _has_api_key():
        return []
    try:
        existing_sample = '、'.join(list(existing_chinese)[:300])
        allowed_cats = (
            "ทั่วไป, ชีวิตประจำวัน, อาหาร, สัตว์, สถานที่, ครอบครัว, บุคคล, ร่างกาย, "
            "การงาน, การเดินทาง, กีฬา, แพทย์, วิศวกรรม, เทคนิค, ธุรกิจ, กฎหมาย, สำนวน"
        )

        topic_instruction = ""
        if keyword:
            topic_instruction = f'หัวข้อ/คีย์เวิร์ด: "{keyword}" — สร้างคำศัพท์ที่เกี่ยวข้องกับหัวข้อนี้\n'

        if category:
            cat_instruction = f'หมวดหมู่: "{category}" เท่านั้น'
            cat_field = f'"category":"{category}"'
        else:
            cat_instruction = "เลือกหมวดหมู่ที่เหมาะสมกับความหมายของคำนั้นๆ"
            cat_field = f'"category":"<one of: {allowed_cats}>"'

        prompt = (
            f"Generate exactly {count} Chinese words (simplified) for Thai learners.\n"
            f"{topic_instruction}"
            f"{cat_instruction}\n"
            f"Do NOT include: {existing_sample}\n"
            f"category MUST be exactly one of these Thai words: {allowed_cats}\n"
            "Return JSON array only, no explanation:\n"
            f'[{{"chinese":"你好",{cat_field}}},...]\n'
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
    For each Thai meaning line (split by \\n):
      - Count semicolons → n_semi
      - Generate (n_semi + 1) conversational examples, one per ;-separated meaning: type "conv_0", "conv_1", ...
      - Generate 1 formal/book/article example: type "formal"
    If there are multiple meaning lines, generate a full set per line.
    Format: [{"meaning_line":0,"type":"conv_0","chinese":"...","pinyin":"...","thai":"..."}]
    """
    if not _has_api_key():
        return []
    try:
        meaning_lines = [l.strip() for l in thai.split('\n') if l.strip()]
        if not meaning_lines:
            meaning_lines = [thai.strip()]

        instructions = []
        example_template = []
        for i, line in enumerate(meaning_lines):
            semi_parts = [p.strip() for p in line.split(';') if p.strip()]
            conv_lines = [
                f'  - type "conv_{j}": ประโยคสนทนา ใช้คำจีนในความหมาย "{part}"'
                for j, part in enumerate(semi_parts)
            ]
            conv_lines.append(
                '  - type "formal": ประโยคทางการ สไตล์บทความ/หนังสือ/ข่าว (ครอบคลุมความหมายหลักของบรรทัดนี้)'
            )
            instructions.append(
                f'ความหมายบรรทัดที่ {i + 1}: "{line}"\n' + '\n'.join(conv_lines)
            )
            for j in range(len(semi_parts)):
                example_template.append(
                    f'{{"meaning_line":{i},"type":"conv_{j}","chinese":"...","pinyin":"...","thai":"..."}}'
                )
            example_template.append(
                f'{{"meaning_line":{i},"type":"formal","chinese":"...","pinyin":"...","thai":"..."}}'
            )

        prompt = (
            f'Chinese word: {chinese} ({pinyin})\n\n'
            f'For each meaning line below, generate example sentences using "{chinese}":\n\n'
            + '\n\n'.join(instructions)
            + '\n\nReturn ONLY a JSON array, no explanation, no markdown:\n['
            + ',\n'.join(example_template)
            + ']'
        )
        response = _model.generate_content(prompt)
        return json.loads(_strip_markdown(response.text))
    except Exception:
        return []
