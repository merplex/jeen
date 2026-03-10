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


def _clean_json(text: str) -> str:
    """ลบ comment //... และ trailing comma ออกจาก JSON string"""
    import re
    # ลบบรรทัดที่ขึ้นต้นด้วย // (comment)
    text = re.sub(r'^\s*//.*$', '', text, flags=re.MULTILINE)
    # ลบ trailing comma ก่อน ] หรือ }
    text = re.sub(r',\s*([\]\}])', r'\1', text)
    return text.strip()


def _get_text(response) -> str:
    """Extract only non-thinking parts from Gemini response."""
    parts = []
    try:
        for part in response.candidates[0].content.parts:
            if not getattr(part, "thought", False):
                parts.append(part.text)
        return "".join(parts).strip()
    except Exception:
        return response.text.strip()


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
        return _get_text(response)
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
        return json.loads(_strip_markdown(_get_text(response)))
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
        return json.loads(_strip_markdown(_get_text(response)))
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
        return json.loads(_strip_markdown(_get_text(response)))
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
            "การงาน, การเดินทาง, กีฬา, แพทย์, วิศวกรรม, เทคนิค, ธุรกิจ, กฎหมาย, สำนวน, พิเศษ"
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
        data = json.loads(_strip_markdown(_get_text(response)))
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
            prompt = (
                f'The string "{word}" was typed in a Chinese dictionary search. '
                "Is it composed of valid Chinese characters that form a meaningful or plausible combination "
                "(including compound words, medical terms, technical terms, or descriptive phrases)? "
                "Answer only yes or no."
            )
        else:
            prompt = f'Is "{word}" a valid English word or common phrase? Answer only yes or no.'
        response = _model.generate_content(prompt)
        return _get_text(response).lower().startswith("yes")
    except Exception:
        return True  # fallback: assume valid


NON_CONVERSATIONAL_CATEGORIES = {"แพทย์", "กฎหมาย", "สำนวน", "วิศวกรรม", "เทคนิค"}


def generate_examples_for_word(chinese: str, pinyin: str, thai: str, category: str = "") -> list[dict]:
    """
    For each Thai meaning line (split by \\n):
      - Normal words: conv_0, conv_1, ... (one per ;-meaning) + 1 formal
      - Non-conversational categories (แพทย์/กฎหมาย/สำนวน/วิศวกรรม/เทคนิค):
        Ask Gemini to judge if the word is actually used in everyday speech.
        - If YES (or has a common colloquial equivalent): generate conv examples normally
        - If NO: skip conv examples, generate 2 formal (article/news/book) examples instead
    Format: [{"meaning_line":0,"type":"conv_0","chinese":"...","pinyin":"...","thai":"..."}]
    """
    if not _has_api_key():
        return []
    try:
        meaning_lines = [l.strip() for l in thai.split('\n') if l.strip()]
        if not meaning_lines:
            meaning_lines = [thai.strip()]

        is_non_conv_category = category.strip() in NON_CONVERSATIONAL_CATEGORIES

        instructions = []
        example_template = []

        if is_non_conv_category:
            # Let Gemini decide per word whether it's conversational or not
            for i, line in enumerate(meaning_lines):
                semi_parts = [p.strip() for p in line.split(';') if p.strip()]
                instructions.append(
                    f'ความหมายบรรทัดที่ {i + 1}: "{line}"\n'
                    f'  - ตรวจสอบก่อนว่า "{chinese}" ถูกใช้ในการสนทนาชีวิตประจำวันจริงๆ หรือไม่\n'
                    f'  - ถ้าใช้ได้จริง (หรือมีคำเรียกทั่วไปที่คนใช้แทน): ให้สร้าง {len(semi_parts)} ประโยคสนทนา (conv_0...) + 1 formal\n'
                    f'  - ถ้าไม่ได้ใช้ในการสนทนา (เช่น ศัพท์แพทย์/กฎหมายที่คนทั่วไปไม่พูด): ให้ข้าม conv ทั้งหมด สร้างแค่ 2 ประโยค formal (formal_0, formal_1) สไตล์บทความ/ข่าว/ตำรา\n'
                    f'  - ถ้ามีคำพูดทั่วไปที่ใช้แทน "{chinese}" ได้ (เช่น แทน 腹直肌 ด้วย 肚子): ให้ใช้คำนั้นในประโยคสนทนาแทน\n'
                    f'  - IMPORTANT: ถ้าสร้าง formal ให้ใช้ type "formal_0" และ "formal_1"; ถ้าสร้าง conv ให้ใช้ type "conv_0", "conv_1", ... และ "formal"'
                )
                # Template: either conv+formal or formal_0+formal_1
                for j in range(len(semi_parts)):
                    example_template.append(
                        f'{{"meaning_line":{i},"type":"conv_{j}","chinese":"...","pinyin":"...","thai":"..."}}'
                    )
                example_template.append(
                    f'{{"meaning_line":{i},"type":"formal","chinese":"...","pinyin":"...","thai":"..."}}'
                )
                # Also provide formal_0/formal_1 slots in case Gemini chooses non-conv path
                example_template.append(
                    f'// OR if non-conversational: {{"meaning_line":{i},"type":"formal_0","chinese":"...","pinyin":"...","thai":"..."}} and {{"meaning_line":{i},"type":"formal_1","chinese":"...","pinyin":"...","thai":"..."}}'
                )
        else:
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

        if is_non_conv_category:
            prompt = (
                f'Chinese word: {chinese} ({pinyin})\n'
                f'Category: {category} (specialized/non-everyday)\n\n'
                f'For each meaning line, first assess whether "{chinese}" is actually used in everyday spoken Chinese.\n'
                f'- If YES or has a common colloquial equivalent → generate conv examples (using the colloquial word in conv if needed) + 1 formal\n'
                f'- If NO (only used in written/professional contexts) → skip conv entirely, generate 2 formal examples (formal_0, formal_1) in article/news/textbook style\n\n'
                + '\n\n'.join(instructions)
                + '\n\nReturn ONLY a valid JSON array (no comments, no explanation, no markdown).\n'
                + 'Use ONLY these types: "conv_0", "conv_1", "formal", "formal_0", "formal_1"\n'
                + 'Example output (non-conv path): [{"meaning_line":0,"type":"formal_0","chinese":"...","pinyin":"...","thai":"..."},{"meaning_line":0,"type":"formal_1","chinese":"...","pinyin":"...","thai":"..."}]\n'
                + 'Example output (conv path): [{"meaning_line":0,"type":"conv_0","chinese":"...","pinyin":"...","thai":"..."},{"meaning_line":0,"type":"formal","chinese":"...","pinyin":"...","thai":"..."}]'
            )
        else:
            prompt = (
                f'Chinese word: {chinese} ({pinyin})\n\n'
                f'For each meaning line below, generate example sentences using "{chinese}":\n\n'
                + '\n\n'.join(instructions)
                + '\n\nReturn ONLY a JSON array, no explanation, no markdown:\n['
                + ',\n'.join(example_template)
                + ']'
            )

        for attempt in range(3):
            try:
                response = _model.generate_content(prompt)
                raw = _clean_json(_strip_markdown(_get_text(response)))
                results = json.loads(raw)
                # กรอง placeholder ที่ Gemini ไม่ได้แทนค่า
                results = [r for r in results if isinstance(r, dict) and r.get("chinese", "") not in ("", "...")]
                if results:
                    return results
            except Exception:
                pass
        return []
    except Exception:
        return []
