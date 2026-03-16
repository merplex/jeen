"""
import_hsk.py — ดึงข้อมูล HSK 3.0 จาก drkameleon/complete-hsk-vocabulary แล้ว:
  1) อัปเดต hsk_level ให้คำที่มีอยู่ใน DB แล้ว (match ด้วย chinese)
  2) Insert คำใหม่ที่ยังไม่มีใน DB (thai_meaning='', status='hsk_pending')

Usage:
  cd /workspaces/jeen/backend
  python scripts/import_hsk.py [--dry-run]
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import json, urllib.request, argparse, unicodedata
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.word import Word


RAW_URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json"


def fetch_hsk_data() -> list[dict]:
    print("Downloading HSK data...")
    with urllib.request.urlopen(RAW_URL, timeout=30) as r:
        data = json.load(r)
    print(f"  → {len(data)} entries")
    return data


def parse_level(levels: list[str]) -> str | None:
    """
    ดึง HSK 3.0 level ออกมาเป็น string เช่น 'hsk4'
    ถ้าไม่มี new-X ให้ใช้ old-X แทน
    """
    new_lvl = None
    old_lvl = None
    for lv in levels:
        if lv.startswith("new-"):
            try:
                new_lvl = int(lv.split("-")[1])
            except ValueError:
                pass
        elif lv.startswith("old-"):
            try:
                old_lvl = int(lv.split("-")[1])
            except ValueError:
                pass
    n = new_lvl if new_lvl is not None else old_lvl
    return f"hsk{n}" if n is not None else None


def normalize_pinyin(p: str) -> str:
    """ถอด diacritic ออก → pinyin_plain สำหรับ matching"""
    return unicodedata.normalize("NFD", p).encode("ascii", "ignore").decode().lower().strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="แสดงผลโดยไม่ write DB")
    args = parser.parse_args()

    hsk_data = fetch_hsk_data()

    # build lookup: simplified → (level, traditional, pinyin, english)
    lookup: dict[str, tuple[int | None, str, str, str]] = {}
    for entry in hsk_data:
        simp = entry.get("simplified", "").strip()
        if not simp:
            continue
        level = parse_level(entry.get("level", []))
        form = entry.get("forms", [{}])[0]
        trad = form.get("traditional", simp)
        pinyin = form.get("transcriptions", {}).get("pinyin", "")
        meanings = form.get("meanings", [])
        english = "; ".join(meanings) if meanings else ""
        lookup[simp] = (level, trad, pinyin, english)

    print(f"HSK vocab size: {len(lookup)}")

    db: Session = SessionLocal()
    try:
        # 1) ดึงคำที่มีอยู่ใน DB ทั้งหมด
        existing_words: list[Word] = db.query(Word).all()
        existing_chinese: set[str] = {w.chinese for w in existing_words}

        updated = 0
        skipped = 0
        for word in existing_words:
            entry = lookup.get(word.chinese)
            if entry:
                lvl = entry[0]
                if word.hsk_level != lvl:
                    if not args.dry_run:
                        word.hsk_level = lvl
                    updated += 1
            else:
                skipped += 1

        print(f"\n[Existing words]")
        print(f"  Updated hsk_level : {updated}")
        print(f"  No HSK match      : {skipped}")

        # 2) คำใหม่ที่ยังไม่มีใน DB
        new_entries = []
        for simp, (lvl, trad, pinyin, english) in lookup.items():
            if simp in existing_chinese:
                continue
            if not pinyin:  # ข้ามถ้าไม่มี pinyin
                continue
            new_entries.append(Word(
                chinese=simp,
                chinese_traditional=trad if trad != simp else None,
                pinyin=pinyin,
                pinyin_plain=normalize_pinyin(pinyin),
                thai_meaning="",
                english_meaning=english or None,
                hsk_level=lvl,
                status="hsk_pending",
                source="hsk3.0",
            ))

        print(f"\n[New HSK words]")
        print(f"  To insert: {len(new_entries)}")

        if not args.dry_run:
            db.bulk_save_objects(new_entries)
            db.commit()
            print("\nDone! Changes saved to DB.")
        else:
            print("\n[DRY RUN] No changes written.")
            print("Sample new entries:")
            for e in new_entries[:5]:
                print(f"  {e.chinese} ({e.pinyin}) {e.hsk_level} — {e.english_meaning}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
