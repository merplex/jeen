import re
import logging
import pandas as pd

logger = logging.getLogger(__name__)
from pathlib import Path
from sqlalchemy.orm import Session
from pypinyin import pinyin, lazy_pinyin, Style
from ..models.word import Word, WordPending


COLUMN_ALIASES = {
    "chinese": ["chinese", "จีน", "ภาษาจีน", "ภาษาจีน (chinese)", "hanzi", "汉字", "中文"],
    "pinyin": ["pinyin", "พินอิน", "pin_yin", "拼音"],
    "thai_meaning": ["thai", "thai_meaning", "ความหมาย", "ความหมายไทย", "ไทย", "thai meaning", "ภาษาไทย", "ภาษาไทย (thai)"],
    "english_meaning": ["english", "english_meaning", "eng", "อังกฤษ", "ภาษาอังกฤษ", "ภาษาอังกฤษ (english)"],
    "category": ["category", "หมวดหมู่", "หมวด", "cat"],
    "chinese_traditional": ["chinese_traditional", "traditional", "ตัวเต็ม", "จีนตัวเต็ม", "繁體", "繁体"],
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
        clean = re.sub(r'^\([^)]+\)\s*', '', sense)
        clean = re.sub(r'\s*,\s*', ', ', clean)
        clean = clean.strip().strip(',').strip()
        if clean:
            result.append((clean, category))

    return result if result else [("", None)]


def _load_single_df(file_path: str, suffix: str, sheet: int | str = 0) -> pd.DataFrame:
    """อ่าน 1 sheet — รองรับทั้งมี header และไม่มี header (auto-detect)"""
    read_kw = {"dtype": str}
    if suffix == ".csv":
        read_kw["encoding"] = "utf-8-sig"

    if suffix in (".xlsx", ".xls"):
        df = pd.read_excel(file_path, sheet_name=sheet, **read_kw)
    else:
        df = pd.read_csv(file_path, **read_kw)

    df = _normalize_columns(df)

    if "chinese" not in df.columns:
        if suffix in (".xlsx", ".xls"):
            df = pd.read_excel(file_path, sheet_name=sheet, header=None, **read_kw)
        else:
            df = pd.read_csv(file_path, header=None, **read_kw)
        df = df.rename(columns={0: "chinese", 1: "thai_meaning"})

    return df


def _load_df(file_path: str, suffix: str) -> pd.DataFrame:
    """อ่านไฟล์ — รองรับทั้งมี header และไม่มี header, รองรับหลาย sheet (Excel)"""
    if suffix not in (".xlsx", ".xls"):
        return _load_single_df(file_path, suffix)

    # Excel: อ่านชื่อ sheet ทั้งหมด แล้วรวมกัน
    xl = pd.ExcelFile(file_path)
    sheets = xl.sheet_names
    dfs = [_load_single_df(file_path, suffix, sheet=s) for s in sheets]
    return pd.concat(dfs, ignore_index=True)


def import_file(db: Session, file_path: str, source: str = "prem_file") -> dict:
    path = Path(file_path)
    if not path.exists():
        return {"success": False, "error": f"ไม่พบไฟล์: {file_path}"}

    suffix = path.suffix.lower()
    if suffix not in (".xlsx", ".xls", ".csv"):
        return {"success": False, "error": "รองรับเฉพาะไฟล์ .xlsx, .xls, .csv"}

    df = _load_df(file_path, suffix)
    df = df.fillna("")

    if "chinese" not in df.columns:
        return {"success": False, "error": "ไม่พบคอลัมน์ภาษาจีน"}

    # โหลด existing: dict เพื่อ upsert (อัปเดตได้ถ้ามีอยู่แล้ว)
    existing_words = {
        (w.chinese, w.pinyin_plain or ""): w
        for w in db.query(Word).all()
    }
    existing_pending = {w[0] for w in db.query(WordPending.chinese).all()}

    # ─── Phase 1: รวม rows ที่มี chinese เดียวกัน (pinyin เดียวกัน) ───────────
    # key = (chinese, pinyin_plain)  →  กรณี polyphonic ที่ระบุ pinyin ต่างกัน แยกเป็นคนละ entry
    from collections import OrderedDict
    groups = OrderedDict()

    for _, row in df.iterrows():
        chinese = str(row.get("chinese", "")).strip()
        if not chinese or not re.search(r'[\u4e00-\u9fff\u3400-\u4dbf\U00020000-\U0002A6DF]', chinese):
            continue

        raw_pinyin = str(row.get("pinyin", "")).strip()
        gen_pinyin = raw_pinyin if raw_pinyin else _gen_pinyin(chinese)
        gen_pinyin_plain = _gen_pinyin_plain(chinese)
        key = (chinese, gen_pinyin_plain)

        thai_raw = str(row.get("thai_meaning", "")).strip()
        english = str(row.get("english_meaning", "")).strip() or None
        category_col = str(row.get("category", "")).strip() or None
        chinese_trad = str(row.get("chinese_traditional", "")).strip() or None

        if thai_raw:
            senses = _parse_thai_meaning(thai_raw)
            # แต่ละ sense (แยกด้วย ;) → บรรทัดแยกกัน
            sense_lines = [m for m, _ in senses if m]
            if not sense_lines:
                sense_lines = [thai_raw]
            parsed_cat = next((c for _, c in senses if c), None)
        else:
            sense_lines = []
            parsed_cat = None

        cat = category_col or parsed_cat

        if key not in groups:
            groups[key] = {
                "chinese": chinese,
                "chinese_traditional": None,
                "pinyin": gen_pinyin,
                "pinyin_plain": gen_pinyin_plain,
                "thai_lines": [],
                "english": None,
                "category": None,
                "row_count": 0,
            }

        g = groups[key]
        g["row_count"] += 1
        # เพิ่มแต่ละ sense เป็นบรรทัดแยก (dedup ภายใน group)
        for sense_line in sense_lines:
            if sense_line not in g["thai_lines"]:
                g["thai_lines"].append(sense_line)
        if not g["english"] and english:
            g["english"] = english
        if not g["category"] and cat:
            g["category"] = cat
        if not g["chinese_traditional"] and chinese_trad:
            g["chinese_traditional"] = chinese_trad

    # ─── Phase 2: insert ─────────────────────────────────────────────────────
    verified = 0
    updated = 0
    pending = 0
    skipped = 0
    updated_words = []

    for key, g in groups.items():
        chinese = g["chinese"]
        thai = "\n".join(g["thai_lines"])

        if thai:
            if key in existing_words:
                # upsert: อัปเดต thai_meaning ด้วยเวอร์ชัน merge จากไฟล์
                word = existing_words[key]
                old_thai = word.thai_meaning or ""
                old_cat = word.category or ""
                new_cat = g["category"] or ""
                thai_changed = old_thai != thai
                cat_changed = g["category"] and old_cat != new_cat

                trad_changed = g["chinese_traditional"] and word.chinese_traditional != g["chinese_traditional"]
                if not thai_changed and not cat_changed and not trad_changed:
                    skipped += 1
                    continue

                if thai_changed:
                    updated_words.append({
                        "id": word.id,
                        "chinese": chinese,
                        "pinyin": g["pinyin"],
                        "old": old_thai,
                        "new": thai,
                    })
                word.thai_meaning = thai
                if g["category"]:
                    word.category = g["category"]
                if g["chinese_traditional"]:
                    word.chinese_traditional = g["chinese_traditional"]
                updated += 1
            else:
                db.add(Word(
                    chinese=chinese,
                    chinese_traditional=g["chinese_traditional"],
                    pinyin=g["pinyin"],
                    pinyin_plain=g["pinyin_plain"],
                    thai_meaning=thai,
                    english_meaning=g["english"],
                    category=g["category"],
                    status="verified",
                ))
                existing_words[key] = True  # mark as inserted
                verified += 1
        elif chinese not in existing_pending:
            db.add(WordPending(
                chinese=chinese,
                pinyin=g["pinyin"],
                pinyin_plain=g["pinyin_plain"],
                english_meaning=g["english"],
                category=g["category"],
                source=source,
            ))
            existing_pending.add(chinese)
            pending += 1
        else:
            skipped += g["row_count"]

    db.commit()

    # Enqueue verified words ที่ไม่มี examples ให้ gen ใน background
    if verified > 0:
        from ..services.example_queue import example_queue
        from ..models.example import Example
        new_words = db.query(Word).filter(
            Word.status == "verified",
            ~Word.id.in_(db.query(Example.word_id).distinct())
        ).order_by(Word.id.desc()).limit(verified).all()
        if new_words:
            example_queue.enqueue_many([w.id for w in new_words])
            logger.info(f"[import] enqueued {len(new_words)} words for example generation")

    return {"success": True, "verified": verified, "updated": updated, "pending": pending, "skipped": skipped, "updated_words": updated_words}
