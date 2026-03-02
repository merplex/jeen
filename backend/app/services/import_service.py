import re
import pandas as pd
from pathlib import Path
from sqlalchemy.orm import Session
from pypinyin import pinyin, lazy_pinyin, Style
from ..models.word import Word, WordPending


COLUMN_ALIASES = {
    "chinese": ["chinese", "จีน", "ภาษาจีน", "hanzi", "汉字", "中文"],
    "pinyin": ["pinyin", "พินอิน", "pin_yin", "拼音"],
    "thai_meaning": ["thai", "thai_meaning", "ความหมาย", "ความหมายไทย", "ไทย", "thai meaning"],
    "english_meaning": ["english", "english_meaning", "eng", "อังกฤษ"],
    "category": ["category", "หมวดหมู่", "หมวด", "cat"],
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    # strip whitespace + BOM (\ufeff) ที่อาจติดมาจาก CSV export ของ Excel
    df.columns = df.columns.str.strip().str.lstrip('\ufeff')
    col_map = {}
    lower_cols = {c.lower().strip(): c for c in df.columns}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias.lower() in lower_cols:
                col_map[lower_cols[alias.lower()]] = field
                break
    return df.rename(columns=col_map)


def _gen_pinyin(chinese: str) -> str:
    return ' '.join([''.join(syllables) for syllables in pinyin(chinese, style=Style.TONE)])


def _gen_pinyin_plain(chinese: str) -> str:
    return ' '.join(lazy_pinyin(chinese))


def _parse_thai_meaning(raw: str) -> list[tuple[str, str | None]]:
    """
    Parse format: "(แพทย์) ยา, เม็ดยา; (เคมี) สารประกอบ"
    Returns: list of (clean_meaning, category_or_None), one per `;`-separated sense.

    - (หมวด) นำหน้าแต่ละความหมาย → ดึงเป็น category ของ sense นั้น
    - , คั่นคำแปลอื่นในความหมายเดียวกัน (คง ; ไว้ในผลลัพธ์)
    - ; คั่นความหมายที่ต่างกันมาก → แยกเป็น sense ใหม่
    """
    raw = raw.strip()
    if not raw:
        return [("", None)]

    senses = [s.strip() for s in raw.split(';') if s.strip()]
    result = []
    for sense in senses:
        category = None
        m = re.match(r'^\(([^)]+)\)', sense)
        if m:
            category = m.group(1).strip()
        clean = re.sub(r'\([^)]+\)\s*', '', sense)
        clean = re.sub(r'\s*,\s*', ', ', clean)
        clean = clean.strip().strip(',').strip()
        if clean:
            result.append((clean, category))

    return result if result else [("", None)]


def import_file(db: Session, file_path: str, source: str = "prem_file") -> dict:
    path = Path(file_path)
    if not path.exists():
        return {"success": False, "error": f"ไม่พบไฟล์: {file_path}"}

    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(file_path, dtype=str)
    elif suffix == ".csv":
        df = pd.read_csv(file_path, dtype=str, encoding='utf-8-sig')
    else:
        return {"success": False, "error": "รองรับเฉพาะไฟล์ .xlsx, .xls, .csv"}

    df = _normalize_columns(df)
    df = df.fillna("")

    if "chinese" not in df.columns:
        return {"success": False, "error": "ไม่พบคอลัมน์ภาษาจีน (chinese / จีน / ภาษาจีน)"}

    # โหลด existing เพื่อ skip ซ้ำ
    # verified: ตรวจด้วย (chinese, pinyin_plain) เพื่อรองรับ polyphonic (คำเดียวหลายเสียง)
    existing_words = {(w[0], w[1] or "") for w in db.query(Word.chinese, Word.pinyin_plain).all()}
    existing_pending = {w[0] for w in db.query(WordPending.chinese).all()}

    verified = 0   # มีคำแปลไทย → เข้า words โดยตรง
    pending = 0    # ไม่มีคำแปล → เข้า words_pending รอแปล
    skipped = 0    # ซ้ำหรือว่าง

    for _, row in df.iterrows():
        chinese = str(row.get("chinese", "")).strip()
        if not chinese:
            skipped += 1
            continue

        raw_pinyin = str(row.get("pinyin", "")).strip()
        gen_pinyin = raw_pinyin if raw_pinyin else _gen_pinyin(chinese)
        gen_pinyin_plain = _gen_pinyin_plain(chinese)
        english = str(row.get("english_meaning", "")).strip() or None
        category_col = str(row.get("category", "")).strip() or None

        # Parse Thai meaning: แยก sense, ดึง category
        thai_raw = str(row.get("thai_meaning", "")).strip()
        if thai_raw:
            senses = _parse_thai_meaning(thai_raw)
            # รวม sense ด้วย "; "  ถ้า parse ได้ว่าง fallback ใช้ raw text
            thai = "; ".join(m for m, _ in senses if m) or thai_raw
            # ใช้ category จากคอลัมน์ก่อน, ถ้าไม่มีใช้จาก parse
            parsed_category = next((c for _, c in senses if c), None)
            category = category_col or parsed_category
        else:
            thai = ""
            category = category_col

        if thai:
            # มีคำแปลไทย → ตรวจซ้ำด้วย (chinese, pinyin_plain)
            key = (chinese, gen_pinyin_plain)
            if key in existing_words:
                skipped += 1
                continue
            db.add(Word(
                chinese=chinese,
                pinyin=gen_pinyin,
                pinyin_plain=gen_pinyin_plain,
                thai_meaning=thai,
                english_meaning=english,
                category=category,
                status="verified",
            ))
            existing_words.add(key)
            verified += 1
        elif chinese not in existing_pending:
            # ไม่มีคำแปล + ไม่ซ้ำใน pending → รอแปล
            db.add(WordPending(
                chinese=chinese,
                pinyin=gen_pinyin,
                pinyin_plain=gen_pinyin_plain,
                english_meaning=english,
                category=category,
                source=source,
            ))
            existing_pending.add(chinese)
            pending += 1
        else:
            skipped += 1

    db.commit()
    return {"success": True, "verified": verified, "pending": pending, "skipped": skipped}
