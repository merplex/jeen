import re, json
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import Response
from pypinyin.contrib.tone_convert import tone3_to_tone
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.word import Word
from ..models.activity_log import ActivityLog
from ..models.word_report import WordReport
from ..models.subscription import UserSubscription
from ..models.app_setting import AppSetting
from ..models.word_image_cache import WordImageCache
from ..schemas.word import WordOut, WordCreate, WordUpdate
from ..auth import require_admin, require_user
from ..models.user import User
from ..models.user_favorite import UserFavorite
from ..services.import_service import _gen_pinyin, _gen_pinyin_plain


def _has_subscription(user_id: int, db: Session) -> bool:
    sub = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user_id, UserSubscription.status == "active")
        .first()
    )
    if not sub:
        return False
    if sub.expires_at and sub.expires_at < datetime.utcnow():
        return False
    return True


def _numeric_to_tone_pinyin(s: str) -> str:
    """แปลง numeric pinyin → tone-marked: 'hao4chi1' → 'hào chī'"""
    syllables = re.findall(r'[a-zü:]+[1-5]?', s.strip().lower())
    return ' '.join(tone3_to_tone(syl) for syl in syllables if syl)

# mapping: tone-marked vowel → (base, tone_digit)
_TONE_VOWELS = {
    'ā': ('a', '1'), 'á': ('a', '2'), 'ǎ': ('a', '3'), 'à': ('a', '4'),
    'ē': ('e', '1'), 'é': ('e', '2'), 'ě': ('e', '3'), 'è': ('e', '4'),
    'ī': ('i', '1'), 'í': ('i', '2'), 'ǐ': ('i', '3'), 'ì': ('i', '4'),
    'ō': ('o', '1'), 'ó': ('o', '2'), 'ǒ': ('o', '3'), 'ò': ('o', '4'),
    'ū': ('u', '1'), 'ú': ('u', '2'), 'ǔ': ('u', '3'), 'ù': ('u', '4'),
    'ǖ': ('v', '1'), 'ǘ': ('v', '2'), 'ǚ': ('v', '3'), 'ǜ': ('v', '4'),
    'ü': ('v', ''),
}


def _normalize_pinyin_key(s: str) -> str:
    """
    Normalize pinyin to comparable key (strips spaces, handles both formats).
    'hǎo chī' → 'hao3chi1'
    'hao3chi1' → 'hao3chi1'
    'hào chī' → 'hao4chi1'
    """
    out, buf, tone = [], [], None
    for ch in s.lower().strip():
        if ch == ' ':
            if buf:
                out.extend(buf)
                if tone:
                    out.append(tone)
                buf.clear()
                tone = None
        elif ch in _TONE_VOWELS:
            base, t = _TONE_VOWELS[ch]
            buf.append(base)
            if t:
                tone = t
        elif ch in '12345' and buf:
            out.extend(buf)
            out.append(ch)
            buf.clear()
            tone = None
        elif ch.isalpha():
            buf.append(ch)
    if buf:
        out.extend(buf)
        if tone:
            out.append(tone)
    return ''.join(out)

router = APIRouter(prefix="/words", tags=["words"])


@router.get("/favorites")
def get_favorites(db: Session = Depends(get_db), user: User = Depends(require_user)):
    """ดึงรายการคำโปรด เรียงจากล่าสุด"""
    rows = (
        db.query(UserFavorite, Word)
        .join(Word, Word.id == UserFavorite.word_id)
        .filter(UserFavorite.user_id == user.id)
        .order_by(UserFavorite.created_at.desc())
        .all()
    )
    return [
        {
            "favorite_id": fav.id,
            "word_id": word.id,
            "chinese": word.chinese,
            "pinyin": word.pinyin,
            "thai_meaning": word.thai_meaning,
            "category": word.category,
            "favorited_at": fav.created_at,
        }
        for fav, word in rows
    ]


@router.post("/{word_id}/favorite")
def toggle_favorite(word_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    """toggle star — เพิ่ม/ลบจากคำโปรด"""
    existing = db.query(UserFavorite).filter(
        UserFavorite.user_id == user.id,
        UserFavorite.word_id == word_id,
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"favorited": False}
    db.add(UserFavorite(user_id=user.id, word_id=word_id))
    db.commit()
    return {"favorited": True}


@router.get("/{word_id}/favorite-status")
def favorite_status(word_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    exists = db.query(UserFavorite).filter(
        UserFavorite.user_id == user.id,
        UserFavorite.word_id == word_id,
    ).first()
    return {"favorited": exists is not None}


@router.get("/public-settings")
def get_public_settings(db: Session = Depends(get_db)):
    """Settings ที่ผู้ใช้ทั่วไปเห็นได้ (เช่น image_categories)"""
    public_keys = ["image_categories"]
    result = {}
    for key in public_keys:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row:
            try:
                result[key] = json.loads(row.value)
            except Exception:
                result[key] = row.value
        else:
            result[key] = [] if key == "image_categories" else None
    return result


@router.get("/random")
def get_random_words(
    limit: int = 30,
    category: str = None,
    db: Session = Depends(get_db),
    _: object = Depends(require_user),
):
    from sqlalchemy import func
    limit = min(max(limit, 1), 60)
    q = db.query(Word).filter(Word.status == "verified")
    if category and category != "ทั้งหมด":
        q = q.filter(Word.category == category)
    words = q.order_by(func.random()).limit(limit).all()
    return words


@router.get("/{word_id}", response_model=WordOut)
def get_word(
    word_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_user),
):
    word = db.query(Word).filter(Word.id == word_id, Word.status == "verified").first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    return word


@router.post("", response_model=WordOut)
def create_word(
    data: WordCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    existing_words = db.query(Word).filter(Word.chinese == data.chinese).all()
    if existing_words:
        if not data.pinyin:
            ids = ', '.join(str(w.id) for w in existing_words)
            raise HTTPException(
                status_code=409,
                detail=f"มีคำว่า '{data.chinese}' อยู่แล้ว (ID: {ids}) — ระบุ Pinyin เพื่อเพิ่มเป็นคำที่มีเสียงต่างกัน",
            )
        user_key = _normalize_pinyin_key(data.pinyin)
        for w in existing_words:
            if _normalize_pinyin_key(w.pinyin) == user_key:
                raise HTTPException(
                    status_code=409,
                    detail=f"มีคำว่า '{data.chinese}' เสียง '{data.pinyin}' อยู่แล้ว (ID: {w.id})",
                )

    d = data.model_dump()
    if not d.get("pinyin"):
        d["pinyin"] = _gen_pinyin(data.chinese)
    elif re.search(r'[1-5]', d["pinyin"]):
        # user กรอก numeric tone → แปลงเป็น tone-marked ก่อนเก็บ
        d["pinyin"] = _numeric_to_tone_pinyin(d["pinyin"])
    if not d.get("pinyin_plain"):
        d["pinyin_plain"] = _gen_pinyin_plain(data.chinese)

    db.add(ActivityLog(action="word_added", chinese=data.chinese, detail=f"ความหมาย: {data.thai_meaning[:60]}"))
    word = Word(**d, status="verified")
    db.add(word)
    db.commit()
    db.refresh(word)
    return word


@router.put("/{word_id}", response_model=WordOut)
def update_word(
    word_id: int,
    data: WordUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    changed_fields = []
    for field, value in data.model_dump(exclude_none=True).items():
        if getattr(word, field) != value:
            changed_fields.append(field)
        setattr(word, field, value)
    word.admin_edited = True
    detail = f"แก้ไข: {', '.join(changed_fields)}" if changed_fields else "แก้ไขข้อมูล"
    db.add(ActivityLog(action="word_edited", word_id=word.id, chinese=word.chinese, detail=detail))
    db.commit()
    db.refresh(word)
    return word


@router.post("/{word_id}/report")
def report_word(
    word_id: int,
    message: str = Body(..., embed=True, min_length=3, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user),
):
    """รายงานปัญหาคำศัพท์ — สำหรับ premium user เท่านั้น"""
    if not current_user.is_admin and not _has_subscription(current_user.id, db):
        raise HTTPException(status_code=403, detail="เฉพาะสมาชิก Premium เท่านั้น")

    word = db.query(Word).filter(Word.id == word_id, Word.status == "verified").first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")

    today_start = datetime.combine(date.today(), datetime.min.time())

    # ตรวจ: รายงานคำเดิมซ้ำ > 3 ครั้ง/วัน
    same_word_today = (
        db.query(WordReport)
        .filter(WordReport.user_id == current_user.id, WordReport.word_id == word_id,
                WordReport.created_at >= today_start)
        .count()
    )
    if same_word_today >= 3:
        current_user.report_flagged = True
        db.commit()
        raise HTTPException(status_code=429, detail="รายงานคำนี้ครบ 3 ครั้งต่อวันแล้ว")

    # ตรวจ: รายงานมากกว่า 10 คำ/วัน
    unique_words_today = (
        db.query(WordReport.word_id)
        .filter(WordReport.user_id == current_user.id, WordReport.created_at >= today_start)
        .distinct()
        .count()
    )
    if unique_words_today >= 10:
        current_user.report_flagged = True
        db.commit()
        raise HTTPException(status_code=429, detail="รายงานครบ 10 คำต่อวันแล้ว")

    db.add(WordReport(word_id=word_id, user_id=current_user.id, message=message))
    db.commit()
    return {"ok": True}


@router.delete("/{word_id}")
def delete_word(
    word_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_admin),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    db.delete(word)
    db.commit()
    return {"ok": True}


def _gemini_wiki_articles(word, _model, _get_text, count: int = 1) -> list[str]:
    """ถาม Gemini ให้แนะนำชื่อบทความ Wikipedia ภาษาอังกฤษ"""
    count_th = "1 ชื่อ" if count == 1 else f"{count} ชื่อที่แตกต่างกัน"
    sep = "" if count == 1 else f"ตอบเป็นชื่อบทความ {count} ชื่อ คั่นด้วย | เท่านั้น ไม่มีคำอธิบาย\n"
    prompt = (
        f"คำจีน: {word.chinese} ({word.pinyin})\n"
        f"ความหมายไทย: {word.thai_meaning}\n"
        f"English: {word.english_meaning or ''}\n\n"
        f"ระบุชื่อบทความ Wikipedia ภาษาอังกฤษ {count_th} ที่มีรูปภาพสวยงามชัดเจนสำหรับคำนี้\n"
        f"{sep}"
        "กฎสำคัญ:\n"
        "- ถ้าเป็นอาหาร/เมนูอาหาร: ให้ระบุชื่อบทความอาหารนั้นโดยตรง เช่น\n"
        "    红烧肉 → Red-braised pork\n"
        "    宫保鸡丁 → Kung Pao chicken\n"
        "    北京烤鸭 → Peking duck\n"
        "    饺子 → Jiaozi\n"
        "    火锅 → Hot pot\n"
        "    炒饭 → Fried rice\n"
        "    汤圆 → Tangyuan\n"
        "- ถ้าเป็นสัตว์: ชื่อสัตว์ภาษาอังกฤษ เช่น Giant panda, Siberian tiger\n"
        "- ถ้าเป็นสถานที่: ชื่อสถานที่ เช่น Great Wall of China, West Lake\n"
        "- ถ้าคำนี้เป็นนามธรรม/กริยา/คุณศัพท์ที่ไม่มีรูปชัดเจน: ตอบว่า NONE\n"
        "ตอบเฉพาะชื่อบทความเท่านั้น ห้ามมีคำอธิบาย"
    )
    r = _model.generate_content(prompt)
    raw = _get_text(r).strip()
    if not raw or raw.upper() == "NONE":
        return []
    titles = [t.strip().strip('"').strip("'") for t in raw.split('|') if t.strip()]
    return [t for t in titles if t and t.upper() != "NONE"]


def _fetch_wiki_thumbnail(title: str) -> str | None:
    """ดึง thumbnail รูปนำบทความจาก Wikipedia"""
    import httpx
    try:
        resp = httpx.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
            headers={"User-Agent": "CTScanDict/1.0 (educational app)"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("originalimage", {}).get("source") or data.get("thumbnail", {}).get("source")
    except Exception:
        pass
    return None


def _fetch_showapi_food_images(query: str, limit: int = 10) -> list[str]:
    """ดึงรูปจาก ShowAPI — ค้นด้วยคำจีน เหมาะกับอาหารจีน/เอเชีย
    Endpoint: route.showapi.com/xxx-x (กำหนดใน SHOWAPI_ENDPOINT)
    Response: {"showapi_res_body": {"contentlist": [{"pic": "url", ...}]}}
    """
    import httpx, os
    key = os.environ.get("SHOWAPI_API_KEY", "")
    endpoint = os.environ.get("SHOWAPI_ENDPOINT", "")
    if not key or not endpoint:
        return []
    try:
        resp = httpx.get(
            endpoint,
            headers={"Authorization": f"APPCODE {key}"},
            params={"name": query, "page": 1, "maxResult": limit},
            timeout=10,
        )
        if resp.status_code == 200:
            body = resp.json().get("showapi_res_body", {})
            items = body.get("contentlist", [])
            return [item["pic"] for item in items if item.get("pic")]
    except Exception:
        pass
    return []


def _fetch_spoonacular_dish_images(query: str, limit: int = 10) -> list[str]:
    """ดึงรูปจาก Spoonacular สำหรับเมนูอาหาร — รูปจะเห็นทั้งจาน (636x393)"""
    import httpx, os
    key = os.environ.get("SPOONACULAR_API_KEY", "")
    if not key:
        return []
    try:
        resp = httpx.get(
            "https://api.spoonacular.com/recipes/complexSearch",
            params={"query": query, "number": limit, "apiKey": key},
            timeout=10,
        )
        if resp.status_code == 200:
            urls = []
            for r in resp.json().get("results", []):
                img = r.get("image", "")
                if img:
                    # เปลี่ยน thumbnail เล็ก → รูปใหญ่เต็มจาน
                    img = img.replace("312x231", "556x370")
                    urls.append(img)
            return urls
    except Exception:
        pass
    return []


def _fetch_spoonacular_ingredient_images(query: str, limit: int = 10) -> list[str]:
    """ดึงรูปจาก Spoonacular สำหรับวัตถุดิบ (ผัก ผลไม้ ฯลฯ)"""
    import httpx, os
    key = os.environ.get("SPOONACULAR_API_KEY", "")
    if not key:
        return []
    try:
        resp = httpx.get(
            "https://api.spoonacular.com/food/ingredients/search",
            params={"query": query, "number": limit, "apiKey": key},
            timeout=10,
        )
        if resp.status_code == 200:
            return [
                f"https://spoonacular.com/cdn/ingredients_500x500/{r['image']}"
                for r in resp.json().get("results", []) if r.get("image")
            ]
    except Exception:
        pass
    return []


def _gemini_food_info(word, _model, _get_text) -> dict:
    """
    คืน dict:
      food_type: 'dish' | 'ingredient'  — dish=เมนูอาหาร, ingredient=วัตถุดิบ/ผัก/ผลไม้
      zh_query: str   — search term ภาษาจีน (สำหรับ ShowAPI)
      en_query: str   — search term ภาษาอังกฤษ (สำหรับ Spoonacular)
      wiki_article: str — ชื่อบทความ Wikipedia ภาษาอังกฤษ
    """
    prompt = (
        f"คำจีน: {word.chinese} ({word.pinyin})\n"
        f"ความหมายไทย: {word.thai_meaning}\n"
        f"English: {word.english_meaning or ''}\n\n"
        "วิเคราะห์คำนี้แล้วตอบในรูปแบบ JSON บรรทัดเดียว ไม่มี markdown:\n"
        '{"food_type":"dish หรือ ingredient",'
        '"zh_query":"คำค้นหาภาษาจีนสำหรับค้นรูปอาหาร เช่น 红烧肉美食, 苹果",'
        '"en_query":"search term ภาษาอังกฤษ เช่น kung pao chicken dish, apple fruit",'
        '"wiki_article":"ชื่อบทความ Wikipedia ภาษาอังกฤษ หรือ null"}\n\n'
        "กฎสำคัญ:\n"
        "- food_type=dish: เมนูอาหารสำเร็จรูป/เครื่องดื่ม → รูปควรเห็นทั้งจาน\n"
        "- food_type=ingredient: วัตถุดิบ/ผัก/ผลไม้/เนื้อดิบ → รูปแสดงวัตถุดิบนั้น\n"
        "- zh_query: ชื่อจีนสำหรับค้นรูป เช่น '红烧肉', '苹果'\n"
        "- en_query: ชื่ออังกฤษสำหรับ Spoonacular เช่น 'red braised pork', 'apple'"
    )
    import json as _json
    r = _model.generate_content(prompt)
    raw = _get_text(r).strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return _json.loads(raw.strip())
    except Exception:
        return {"food_type": "dish", "zh_query": word.chinese, "en_query": word.english_meaning or "", "wiki_article": None}


def _gemini_place_info(word, _model, _get_text) -> dict:
    """
    คืน dict สำหรับหมวดสถานที่:
      en_query: str   — ชื่อสถานที่ภาษาอังกฤษ (สำหรับ Google Places)
      wiki_article: str — ชื่อบทความ Wikipedia ภาษาอังกฤษ
    """
    prompt = (
        f"คำจีน: {word.chinese} ({word.pinyin})\n"
        f"ความหมายไทย: {word.thai_meaning}\n"
        f"English: {word.english_meaning or ''}\n\n"
        "ตอบในรูปแบบ JSON บรรทัดเดียว ไม่มี markdown:\n"
        '{"en_query":"ชื่อสถานที่ภาษาอังกฤษสำหรับค้น Google Places เช่น Great Wall of China, West Lake Hangzhou",'
        '"wiki_article":"ชื่อบทความ Wikipedia ภาษาอังกฤษ หรือ null"}\n\n'
        "กฎ: en_query ต้องเป็นชื่อเฉพาะของสถานที่ที่ค้นหาได้จริงบน Google Maps"
    )
    import json as _json
    r = _model.generate_content(prompt)
    raw = _get_text(r).strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return _json.loads(raw.strip())
    except Exception:
        return {"en_query": word.english_meaning or word.chinese, "wiki_article": None}


def _fetch_google_places_images(query: str, limit: int = 5) -> list[str]:
    """ดึงรูปจาก Google Places API Text Search → Photo Reference"""
    import httpx, os
    key = os.environ.get("GOOGLE_PLACES_API_KEY", "")
    if not key:
        return []
    urls: list[str] = []
    try:
        resp = httpx.get(
            "https://maps.googleapis.com/maps/api/place/textsearch/json",
            params={"query": query, "key": key},
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        for place in resp.json().get("results", [])[:3]:
            for photo in place.get("photos", [])[:2]:
                ref = photo.get("photo_reference")
                if ref:
                    urls.append(
                        f"https://maps.googleapis.com/maps/api/place/photo"
                        f"?maxwidth=800&photoreference={ref}&key={key}"
                    )
                    if len(urls) >= limit:
                        return urls
    except Exception:
        pass
    return urls


def _wiki_fallback(word, wiki_art: str, _model, _get_text) -> list[str]:
    """Wikipedia fallback — ใช้ร่วมกันทุก category"""
    pool: list[str] = []
    if wiki_art:
        url = _fetch_wiki_thumbnail(wiki_art)
        if url:
            pool.append(url)
    if not pool:
        titles = _gemini_wiki_articles(word, _model, _get_text, count=3)
        for t in titles:
            url = _fetch_wiki_thumbnail(t)
            if url:
                pool.append(url)
    return pool


def _build_image_pool(word, _model, _get_text, limit: int = 15) -> tuple[list[str], dict]:
    """
    Entry point หลัก — แยก path ตาม word.category:
      'อาหาร'   → ShowAPI (zh) + Spoonacular + Wikipedia
      'สถานที่'  → Google Places + Wikipedia
      อื่นๆ     → Wikipedia เท่านั้น
    คืน (pool, info) โดย info คือข้อมูลจาก Gemini (สำหรับ debug)
    """
    cat = (word.category or "").strip()

    if cat == "อาหาร":
        # ถ้า Gemini ล้มเหลว ใช้ข้อมูลจาก word โดยตรง
        try:
            info = _gemini_food_info(word, _model, _get_text)
        except Exception:
            info = {"food_type": "dish", "zh_query": "", "en_query": word.english_meaning or "", "wiki_article": None}

        pool: list[str] = []
        food_type = (info.get("food_type") or "dish").lower()
        fetch_fn = _fetch_spoonacular_ingredient_images if food_type == "ingredient" else _fetch_spoonacular_dish_images

        # 1) Wikipedia ก่อน (ฟรี ไม่จำกัด มีรูปอาหารจีนสวย)
        try:
            pool = _wiki_fallback(word, info.get("wiki_article") or "", _model, _get_text)
        except Exception:
            pass

        # 2) ถ้า Wikipedia ไม่มีรูป → ลอง Spoonacular (English only, ไม่ส่ง CJK)
        if not pool:
            seen: set[str] = set()
            en_queries: list[str] = []
            for q in [info.get("en_query") or "", word.english_meaning or "", word.thai_meaning or ""]:
                q = q.strip()
                if q and not _has_cjk(q) and q not in seen:
                    seen.add(q)
                    en_queries.append(q)
            for q in en_queries:
                if pool:
                    break
                pool = fetch_fn(q, limit=limit)

        return pool, info

    elif cat == "สถานที่":
        # ถ้า Gemini ล้มเหลว ใช้ english_meaning หรือ chinese โดยตรง
        try:
            info = _gemini_place_info(word, _model, _get_text)
        except Exception:
            info = {"en_query": word.english_meaning or word.chinese or "", "wiki_article": None}

        en_q = info.get("en_query") or ""
        pool = _fetch_google_places_images(en_q, limit=limit) if en_q else []
        if len(pool) < 3:
            try:
                pool += _wiki_fallback(word, info.get("wiki_article") or "", _model, _get_text)
            except Exception:
                pass
        return pool, info

    else:
        # category อื่น: Wikipedia อย่างเดียว
        pool = _wiki_fallback(word, "", _model, _get_text)
        return pool, {}


def _has_cjk(s: str) -> bool:
    """ตรวจว่า string มีตัวอักษรจีน/ญี่ปุ่น/เกาหลีไหม"""
    return any('\u4e00' <= c <= '\u9fff' or '\u3040' <= c <= '\u30ff' for c in s)


def _detect_source(url: str) -> str:
    if "googleapis.com/maps" in url:
        return "google_places"
    if "spoonacular" in url:
        return "spoonacular"
    if "wikimedia" in url or "wikipedia" in url:
        return "wikipedia"
    return "unknown"


def _download_image(url: str) -> bytes | None:
    """Download รูปจาก URL คืน bytes หรือ None ถ้าล้มเหลว"""
    import httpx
    try:
        r = httpx.get(url, timeout=15, follow_redirects=True)
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
            return r.content
    except Exception:
        pass
    return None


@router.get("/{word_id}/image")
def get_word_image(word_id: int, db: Session = Depends(get_db)):
    """ดึง URL รูปภาพ — download เก็บ DB ทุก source"""
    import logging
    logger = logging.getLogger(__name__)

    cache = db.query(WordImageCache).filter(WordImageCache.word_id == word_id).first()
    if cache is not None:
        if cache.image_data:
            return {"url": f"/words/{word_id}/image/blob"}
        if cache.image_url:
            return {"url": cache.image_url}
        # cache exists but url=null → ลบแล้ว retry
        db.delete(cache)
        db.commit()

    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")

    from ..services.translate_service import _model, _has_api_key, _get_text
    if not _has_api_key():
        return {"url": None}

    try:
        pool, info = _build_image_pool(word, _model, _get_text, limit=5)
        raw_url = pool[0] if pool else None
        logger.info(f"[image] word={word_id} cat={word.category} pool={len(pool)} url={raw_url} info={info}")
        if raw_url:
            source = _detect_source(raw_url)
            db.add(WordImageCache(word_id=word_id, image_url=raw_url, image_source=source))
            db.commit()
        return {"url": raw_url}
    except Exception as e:
        logger.error(f"[image] word={word_id} error={e}")
        return {"url": None, "error": str(e)}


@router.get("/{word_id}/image/blob")
def get_image_blob(word_id: int, db: Session = Depends(get_db)):
    """เสิร์ฟรูปที่ download เก็บใน DB"""
    cache = db.query(WordImageCache).filter(WordImageCache.word_id == word_id).first()
    if not cache or not cache.image_data:
        raise HTTPException(status_code=404, detail="ไม่มีรูปใน DB")
    return Response(content=cache.image_data, media_type="image/jpeg")


@router.get("/{word_id}/image/debug")
def debug_word_image(word_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Debug: ดู info จาก Gemini และ pool URLs โดยไม่แก้ cache"""
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")
    from ..services.translate_service import _model, _has_api_key, _get_text
    if not _has_api_key():
        return {"error": "no api key"}
    pool, info = _build_image_pool(word, _model, _get_text, limit=5)
    return {"word": word.chinese, "category": word.category, "info": info, "pool_count": len(pool), "pool": pool}


@router.post("/{word_id}/image/refresh")
def refresh_word_image(word_id: int, db: Session = Depends(get_db), _: User = Depends(require_user)):
    """สุ่มรูปใหม่จาก pool ตาม category"""
    import random as _random

    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="ไม่พบคำศัพท์")

    from ..services.translate_service import _model, _has_api_key, _get_text
    if not _has_api_key():
        return {"url": None}

    try:
        cache = db.query(WordImageCache).filter(WordImageCache.word_id == word_id).first()
        current_url = cache.image_url if cache else None

        pool, _ = _build_image_pool(word, _model, _get_text, limit=10)
        if not pool:
            return {"url": None}

        candidates = [u for u in pool if u != current_url]
        if not candidates:
            candidates = pool
        _random.shuffle(candidates)
        raw_url = candidates[0]
        source = _detect_source(raw_url)
        if cache:
            cache.image_url = raw_url
            cache.image_data = None
            cache.image_source = source
        else:
            db.add(WordImageCache(word_id=word_id, image_url=raw_url, image_source=source))
        db.commit()
        return {"url": raw_url}
    except Exception:
        return {"url": None}
