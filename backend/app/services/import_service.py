import pandas as pd
from pathlib import Path
from sqlalchemy.orm import Session
from pypinyin import pinyin, lazy_pinyin, Style
from ..models.word import WordPending


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
    """Generate tone-marked pinyin from Chinese characters."""
    return ' '.join([''.join(syllables) for syllables in pinyin(chinese, style=Style.TONE)])


def _gen_pinyin_plain(chinese: str) -> str:
    """Generate plain (no-tone) pinyin from Chinese characters."""
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

    inserted = 0
    skipped = 0
    for _, row in df.iterrows():
        chinese = str(row.get("chinese", "")).strip()
        if not chinese:
            skipped += 1
            continue

        raw_pinyin = str(row.get("pinyin", "")).strip()
        # auto-gen pinyin if not provided
        generated_pinyin = raw_pinyin if raw_pinyin else _gen_pinyin(chinese)
        # always gen pinyin_plain from chinese
        generated_pinyin_plain = _gen_pinyin_plain(chinese)

        word = WordPending(
            chinese=chinese,
            pinyin=generated_pinyin or None,
            pinyin_plain=generated_pinyin_plain or None,
            thai_meaning=str(row.get("thai_meaning", "")).strip() or None,
            english_meaning=str(row.get("english_meaning", "")).strip() or None,
            category=str(row.get("category", "")).strip() or None,
            source=source,
        )
        db.add(word)
        inserted += 1

    db.commit()
    return {"success": True, "inserted": inserted, "skipped": skipped}
