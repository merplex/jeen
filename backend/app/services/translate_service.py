import json
import logging
import threading
from datetime import datetime, timedelta
from google import genai
from google.genai import types as genai_types
from ..config import settings

logger = logging.getLogger(__name__)

_client = genai.Client(api_key=settings.GEMINI_API_KEY, http_options={"api_version": "v1"})

# ---- Gemini rate limiter: 990 calls/day, 45 calls/hour ----
class _GeminiRateLimiter:
    DAILY_LIMIT = 990
    HOURLY_LIMIT = 45

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

MODEL_NAME = "gemini-2.5-flash-lite"

class _RateLimitedModel:
    """ครอบ Gemini client เพื่อ rate limit ทุก call อัตโนมัติ"""
    def generate_content(self, prompt: str):
        _rate_limiter.acquire()
        return _client.models.generate_content(model=MODEL_NAME, contents=prompt)

_model = _RateLimitedModel()

# ---- OpenAI fallback ----
_openai_client = None
if settings.OPENAI_API_KEY:
    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
    except ImportError:
        logger.warning("openai package not installed — OpenAI fallback unavailable")

OPENAI_MODEL = "gpt-4o-mini"

# Gemini cooldown: ถ้า quota หมด จะ block จนถึงเวลานี้
_gemini_blocked_until: datetime | None = None
_gemini_block_lock = threading.Lock()


def _is_gemini_blocked() -> bool:
    global _gemini_blocked_until
    with _gemini_block_lock:
        if _gemini_blocked_until is None:
            return False
        if datetime.now() >= _gemini_blocked_until:
            _gemini_blocked_until = None
            logger.info("[AI] Gemini cooldown ended — switching back to Gemini")
            return False
        return True


def _block_gemini_for(hours: float = 1.0):
    global _gemini_blocked_until
    with _gemini_block_lock:
        until = datetime.now() + timedelta(hours=hours)
        _gemini_blocked_until = until
        logger.warning(f"[AI] Gemini quota exceeded — switching to OpenAI until {until.strftime('%H:%M')}")


_openai_daily_count = 0
_openai_count_lock = threading.Lock()
_openai_count_day = datetime.now().date()


def _openai_counter_increment():
    global _openai_daily_count, _openai_count_day
    with _openai_count_lock:
        today = datetime.now().date()
        if today != _openai_count_day:
            _openai_daily_count = 0
            _openai_count_day = today
        _openai_daily_count += 1


def openai_status() -> dict:
    global _openai_daily_count, _openai_count_day
    with _openai_count_lock:
        today = datetime.now().date()
        if today != _openai_count_day:
            _openai_daily_count = 0
            _openai_count_day = today
        return {
            "daily_used": _openai_daily_count,
            "available": _openai_client is not None,
        }


def gemini_blocked_status() -> dict:
    """คืน {'blocked': bool, 'until': 'HH:MM' | None}"""
    with _gemini_block_lock:
        if _gemini_blocked_until is None or datetime.now() >= _gemini_blocked_until:
            return {"blocked": False, "until": None}
        return {"blocked": True, "until": _gemini_blocked_until.strftime("%H:%M")}


def _call_openai(prompt: str) -> str:
    if _openai_client is None:
        raise RuntimeError("OpenAI client not available")
    resp = _openai_client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )
    _openai_counter_increment()
    return resp.choices[0].message.content.strip()


def _is_quota_error(e: Exception) -> bool:
    """ตรวจว่า exception เป็น quota/rate-limit error จาก Gemini API จริงๆ"""
    msg = str(e).lower()
    return any(x in msg for x in ["quota", "rate", "429", "resource_exhausted", "exhausted", "limit"])


def _block_gemini_hourly():
    now = datetime.now()
    _block_gemini_for((60 - now.minute) / 60)


def _block_gemini_daily():
    now = datetime.now()
    _block_gemini_for((24 - now.hour) + (1 - now.minute / 60))


def _call_ai(prompt: str) -> str:
    """ลอง Gemini ก่อน — ถ้า quota หมด (internal หรือ API จริง) fallback ไป OpenAI"""
    if not _is_gemini_blocked():
        try:
            response = _model.generate_content(prompt)
            return _get_text(response)
        except RuntimeError as e:
            if "limit reached" in str(e):
                if "daily" in str(e):
                    _block_gemini_daily()
                else:
                    _block_gemini_hourly()
            else:
                raise
        except Exception as e:
            if _is_quota_error(e):
                _block_gemini_hourly()
            else:
                raise
    # Gemini blocked → ใช้ OpenAI
    return _call_openai(prompt)


def _call_gemini(prompt: str) -> str:
    """เรียก Gemini โดยตรง ไม่ fallback OpenAI
    แปลง Google API quota error → RuntimeError ให้ queue worker จับและ sleep"""
    try:
        response = _model.generate_content(prompt)
        return _get_text(response)
    except RuntimeError:
        raise
    except Exception as e:
        if _is_quota_error(e):
            raise RuntimeError(f"Gemini hourly limit reached (API quota): {e}") from e
        raise


def _has_api_key() -> bool:
    return (
        (bool(settings.GEMINI_API_KEY) and settings.GEMINI_API_KEY != "your_gemini_api_key_here")
        or bool(settings.OPENAI_API_KEY)
    )


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
    Uses OpenAI first (free tier); falls back to Gemini if OpenAI unavailable.
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
        if _openai_client is not None:
            raw = _call_openai(prompt)
        else:
            raw = _call_gemini(prompt)
        data = json.loads(_strip_markdown(raw))
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
        return json.loads(_strip_markdown(_call_ai(prompt)))
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
        return json.loads(_strip_markdown(_call_ai(prompt)))
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
        return json.loads(_strip_markdown(_call_ai(prompt)))
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
        data = json.loads(_strip_markdown(_call_ai(prompt)))
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
        return _call_ai(prompt).lower().startswith("yes")
    except Exception:
        return True  # fallback: assume valid


# ---- jieba Chinese validator ----
_jieba_total = 0
_jieba_not_found = 0
_jieba_lock = threading.Lock()
_jieba_ready = False
_jieba_dirty = False  # มีการเปลี่ยนแปลงที่ยังไม่ได้ flush ไป DB


def _load_jieba_stats_from_db():
    """โหลดสถิติ jieba จาก app_settings ตอน startup"""
    global _jieba_total, _jieba_not_found
    try:
        from ..database import SessionLocal
        from ..models.app_setting import AppSetting
        db = SessionLocal()
        try:
            total_row = db.query(AppSetting).filter(AppSetting.key == "jieba_total").first()
            not_found_row = db.query(AppSetting).filter(AppSetting.key == "jieba_not_found").first()
            with _jieba_lock:
                _jieba_total = int(total_row.value) if total_row else 0
                _jieba_not_found = int(not_found_row.value) if not_found_row else 0
            logger.info(f"[jieba] loaded stats from DB: total={_jieba_total} not_found={_jieba_not_found}")
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"[jieba] failed to load stats from DB: {e}")


def _flush_jieba_stats_to_db():
    """flush สถิติ jieba ลง app_settings"""
    global _jieba_dirty
    try:
        from ..database import SessionLocal
        from ..models.app_setting import AppSetting
        with _jieba_lock:
            total = _jieba_total
            not_found = _jieba_not_found
            _jieba_dirty = False
        db = SessionLocal()
        try:
            for key, val in [("jieba_total", total), ("jieba_not_found", not_found)]:
                row = db.query(AppSetting).filter(AppSetting.key == key).first()
                if row:
                    row.value = str(val)
                else:
                    db.add(AppSetting(key=key, value=str(val)))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"[jieba] failed to flush stats to DB: {e}")


def _jieba_flush_loop():
    """background thread flush ทุก 60 วิ"""
    import time
    while True:
        time.sleep(60)
        with _jieba_lock:
            dirty = _jieba_dirty
        if dirty:
            _flush_jieba_stats_to_db()


def _init_jieba():
    global _jieba_ready
    try:
        import jieba
        jieba.initialize()
        _jieba_ready = True
        logger.info("[jieba] initialized")
        _load_jieba_stats_from_db()
    except Exception as e:
        logger.warning(f"[jieba] init failed: {e}")


threading.Thread(target=_init_jieba, daemon=True).start()
threading.Thread(target=_jieba_flush_loop, daemon=True).start()


def validate_chinese_jieba(word: str) -> bool:
    """ตรวจคำจีนด้วย jieba dictionary — คืน True ถ้ารู้จัก, False ถ้าไม่รู้จัก"""
    global _jieba_total, _jieba_not_found, _jieba_dirty
    try:
        import jieba
        found = word in jieba.dt.FREQ
        with _jieba_lock:
            _jieba_total += 1
            if not found:
                _jieba_not_found += 1
            _jieba_dirty = True
        return found
    except Exception:
        return True  # fallback: assume valid


def jieba_stats() -> dict:
    with _jieba_lock:
        return {"total": _jieba_total, "not_found": _jieba_not_found}


NON_CONVERSATIONAL_CATEGORIES = {"แพทย์", "กฎหมาย", "สำนวน", "วิศวกรรม", "เทคนิค"}


def batch_generate_examples(words: list[dict]) -> dict[int, list[dict]]:
    """
    รับ [{"id": int, "chinese": str, "pinyin": str, "thai": str, "category": str}]
    คืน {word_id: [{"meaning_line": int, "type": str, "chinese": str, "pinyin": str, "thai": str}]}

    1 Gemini request สำหรับทั้ง batch
    """
    if not _has_api_key() or not words:
        return {}
    try:
        lines = []
        for w in words:
            meaning_lines = [l.strip() for l in w["thai"].split("\n") if l.strip()] or [w["thai"].strip()]
            thai_repr = " | ".join(meaning_lines).replace('"', "'")
            cat = w.get("category", "")
            non_conv = "(non-everyday category)" if cat in NON_CONVERSATIONAL_CATEGORIES else ""
            lines.append(
                f'id={w["id"]} chinese={w["chinese"]} pinyin={w["pinyin"]} '
                f'thai="{thai_repr}" category={cat} {non_conv}'
            )
        word_list = "\n".join(lines)

        prompt = (
            "Generate example sentences for each Chinese word below.\n\n"
            "RULES:\n"
            "- Split thai by ' | ' to get meaning lines (meaning_line index starts at 0)\n"
            "- For each meaning line, split by ';' to get sub-meanings\n"
            "- type conv_0, conv_1, ... : one conversational sentence per sub-meaning\n"
            "- type formal: one formal/article-style sentence per meaning line\n"
            "- If marked (non-everyday category):\n"
            "  - If the word IS used in everyday speech → generate conv + formal normally\n"
            "  - If NOT used in everyday speech → generate ONLY formal_0 + formal_1 (no conv types)\n"
            "- IMPORTANT: word_id must match the id from input exactly\n\n"
            "WORDS:\n"
            f"{word_list}\n\n"
            "Return ONLY a JSON array, no explanation, no markdown:\n"
            '[{"word_id":<id>,"meaning_line":0,"type":"conv_0","chinese":"...","pinyin":"...","thai":"..."},...]'
        )

        raw = _clean_json(_strip_markdown(_call_gemini(prompt)))
        results = json.loads(raw)
        results = [r for r in results if isinstance(r, dict) and r.get("chinese", "") not in ("", "...")]

        input_ids = {w["id"] for w in words}
        returned_ids = {r.get("word_id") for r in results if r.get("word_id") is not None}
        missing_ids = input_ids - {int(i) for i in returned_ids if i is not None}
        logger.info(f"[batch_gen_examples] got {len(results)} examples for {len(returned_ids)}/{len(input_ids)} words, missing={missing_ids if missing_ids else 'none'}")

        # จัดกลุ่มตาม word_id
        grouped: dict[int, list[dict]] = {}
        for r in results:
            wid = r.get("word_id")
            if wid is None:
                continue
            grouped.setdefault(int(wid), []).append({
                "meaning_line": r.get("meaning_line", 0),
                "type": r.get("type", "conv_0"),
                "chinese": r.get("chinese", ""),
                "pinyin": r.get("pinyin", ""),
                "thai": r.get("thai", ""),
            })
        return grouped
    except RuntimeError:
        raise  # quota exceeded — ให้ queue worker จับ
    except Exception as e:
        logger.error(f"[batch_gen_examples] failed: {e}")
        return {}


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
                raw = _clean_json(_strip_markdown(_call_gemini(prompt)))
                results = json.loads(raw)
                # กรอง placeholder ที่ Gemini ไม่ได้แทนค่า
                results = [r for r in results if isinstance(r, dict) and r.get("chinese", "") not in ("", "...")]
                if results:
                    return results
                logger.warning(f"[gen_examples] attempt {attempt+1}: Gemini returned empty/placeholder for {chinese!r}, raw={raw[:200]!r}")
            except RuntimeError:
                raise  # quota exceeded — ให้ queue worker จับและ sleep
            except Exception as e:
                logger.warning(f"[gen_examples] attempt {attempt+1}: exception for {chinese!r}: {e}")
        return []
    except RuntimeError:
        raise  # quota exceeded — ให้ queue worker จับและ sleep
    except Exception as e:
        logger.error(f"[gen_examples] outer exception for {chinese!r}: {e}")
        return []
