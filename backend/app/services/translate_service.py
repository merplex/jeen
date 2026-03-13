import json
import logging
import threading
from datetime import datetime
from google import genai
from google.genai import types as genai_types
from ..config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options={"api_version": "v1"})

# ---- Gemini rate limiter: 900 calls/day, 40 calls/hour ----
class _GeminiRateLimiter:
    DAILY_LIMIT = 900
    HOURLY_LIMIT = 40

    def __init__(self):
        self._lock = threading.Lock()
        self._daily = 0
        self._hourly = 0
        self._day = datetime.now().date()
        self._hour = datetime.now().hour

    def _reset_if_needed(self):
        now = datetime.now()
        if now.date() != self._day:
            self._daily = 0
            self._day = now.date()
        if now.hour != self._hour:
            self._hourly = 0
            self._hour = now.hour

    def acquire(self):
        with self._lock:
            self._reset_if_needed()
            if self._daily >= self.DAILY_LIMIT:
                raise RuntimeError(f"Gemini daily limit reached ({self.DAILY_LIMIT}/day) — ลองใหม่พรุ่งนี้")
            if self._hourly >= self.HOURLY_LIMIT:
                raise RuntimeError(f"Gemini hourly limit reached ({self.HOURLY_LIMIT}/hour) — ลองใหม่ชั่วโมงหน้า")
            self._daily += 1
            self._hourly += 1

    def status(self):
        with self._lock:
            self._reset_if_needed()
            return {
                "daily_used": self._daily,
                "daily_limit": self.DAILY_LIMIT,
                "hourly_used": self._hourly,
                "hourly_limit": self.HOURLY_LIMIT,
            }

_rate_limiter = _GeminiRateLimiter()

MODEL_NAME = "gemini-2.0-flash-lite"

class _RateLimitedModel:
    """ครอบ Gemini client เพื่อ rate limit ทุก call อัตโนมัติ"""
    def generate_content(self, prompt: str):
        _rate_limiter.acquire()
        return _client.models.generate_content(model=MODEL_NAME, contents=prompt)

_model = _RateLimitedModel()


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


def generate_english_meaning(chinese: str, thai: str) -> dict:
    """Returns {"english": "...", "thai_addition": "..."}
    thai_addition is non-empty only if Chinese has a meaning absent from Thai.
    """
    if not _has_api_key():
        return {"english": "", "thai_addition": ""}
    try:
        prompt = (
            f"Chinese word: {chinese}\n"
            f"Thai meaning (context only): {thai}\n\n"
            "Tasks:\n"
            "1. List ALL common English translations for the Chinese word (comma-separated). Be comprehensive — include every meaning the word can have, based on Chinese as the primary source.\n"
            "2. If multiple English synonyms fit the same meaning, use the Thai meaning to choose the most fitting one; include others as well.\n"
            "3. If the Chinese word has a meaning completely absent from the Thai meaning, provide a short Thai phrase for that missing meaning (1-5 words). Leave empty string if all meanings are already covered.\n\n"
            'Example: {"english":"holiday, vacation, break, school break","thai_addition":""}\n'
            'Return JSON only, no explanation: {"english":"...","thai_addition":""}'
        )
        response = _model.generate_content(prompt)
        data = json.loads(_strip_markdown(_get_text(response)))
        return {
            "english": str(data.get("english", "")).strip(),
            "thai_addition": str(data.get("thai_addition", "")).strip(),
        }
    except Exception:
        return {"english": "", "thai_addition": ""}


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
    คืน [{"id": x, "english": "all, english, meanings", "thai_addition": "..."}]
    — ใส่ทุก meaning ที่เป็นไปได้ คั่นด้วย comma
    — thai_addition: ความหมายที่มีในจีนแต่ไม่มีในไทย (ถ้ามี)
    """
    if not _has_api_key() or not words:
        return []
    try:
        items = "\n".join(
            f'id={w["id"]} chinese={w["chinese"]} thai={w.get("thai","")}'
            for w in words
        )
        prompt = (
            "For each Chinese word below, provide ALL English translations (comma-separated).\n"
            "RULES:\n"
            "- Always provide AT LEAST 2 English words (synonyms, related terms, or alternate translations).\n"
            "- Translate from Chinese primarily — do NOT limit yourself to the Thai meaning.\n"
            "- Use Thai meaning only as a hint when selecting between synonyms, not as a cap on how many to include.\n"
            "- Include every distinct English meaning the Chinese word can have.\n"
            "- If the Chinese word has meanings NOT covered by the Thai at all, list them in 'thai_addition'.\n"
            "IMPORTANT: Keep the exact numeric 'id' from input.\n"
            "Example: id=1042 chinese=假期 thai=ช่วงปิดเทอม → {\"id\":1042,\"english\":\"holiday, vacation, break, school break\",\"thai_addition\":\"วันหยุดพักร้อน\"}\n"
            f"{items}\n\n"
            "Return a JSON array only, no explanation, no markdown:\n"
            '[{"id":<exact id from input>,"english":"word1, word2, word3","thai_addition":""},...]'
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
                logger.warning(f"[gen_examples] attempt {attempt+1}: Gemini returned empty/placeholder for {chinese!r}, raw={raw[:200]!r}")
            except Exception as e:
                logger.warning(f"[gen_examples] attempt {attempt+1}: exception for {chinese!r}: {e}")
        return []
    except Exception as e:
        logger.error(f"[gen_examples] outer exception for {chinese!r}: {e}")
        return []
