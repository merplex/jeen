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


def import_file(db: Session, file_path: str, source: str = "prem_file") -> dict:
    path = Path(file_path)
    if not path.exists():
        return {"success": False, "error": f"ไม่พบไฟล์: {file_path}"}

    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(file_path, dtype=str)
    elif suffix == ".csv":
        df = pd.read_csv(file_path, dtype=str)
    else:
        return {"success": False, "error": "รองรับเฉพาะไฟล์ .xlsx, .xls, .csv"}

    df = _normalize_columns(df)
    df = df.fillna("")

    if "chinese" not in df.columns:
        return {"success": False, "error": "ไม่พบคอลัมน์ภาษาจีน (chinese / จีน / ภาษาจีน)"}

    # โหลด existing เพื่อ skip ซ้ำ
    existing_words = {w[0] for w in db.query(Word.chinese).all()}
    existing_pending = {w[0] for w in db.query(WordPending.chinese).all()}

    verified = 0   # มีคำแปลไทย → เข้า words โดยตรง
    pending = 0    # ไม่มีคำแปล → เข้า words_pending รอแปล
    skipped = 0    # ซ้ำหรือว่าง

    for _, row in df.iterrows():
        chinese = str(row.get("chinese", "")).strip()
        if not chinese:
            skipped += 1
            continue

        # ซ้ำใน words แล้ว → ข้าม
        if chinese in existing_words:
            skipped += 1
            continue

        thai = str(row.get("thai_meaning", "")).strip()
        raw_pinyin = str(row.get("pinyin", "")).strip()
        gen_pinyin = raw_pinyin if raw_pinyin else _gen_pinyin(chinese)
        gen_pinyin_plain = _gen_pinyin_plain(chinese)
        english = str(row.get("english_meaning", "")).strip() or None
        category = str(row.get("category", "")).strip() or None

        if thai:
            # มีคำแปลไทย → เข้า words (verified) ทันที
            db.add(Word(
                chinese=chinese,
                pinyin=gen_pinyin,
                pinyin_plain=gen_pinyin_plain,
                thai_meaning=thai,
                english_meaning=english,
                category=category,
                status="verified",
            ))
            existing_words.add(chinese)
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
