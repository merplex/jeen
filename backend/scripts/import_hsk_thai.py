"""
import_hsk_thai.py — อ่าน hsk_with_thai.csv แล้ว update thai_meaning เข้า DB
Usage:
  DATABASE_URL="postgresql://..." python scripts/import_hsk_thai.py [--dry-run]
"""

import re, argparse, os
import pandas as pd
import psycopg2

INPUT_FILE = os.path.join(os.path.dirname(__file__), "hsk_with_thai.csv")

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://dictuser:dictpass@localhost:5432/thaidict")
DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def normalize_meaning(text: str) -> str:
    parts = re.split(r'\s*;\s*', text.strip())
    lines = [p.strip() for p in parts if p.strip()]
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    df = pd.read_csv(INPUT_FILE, dtype=str)
    df['thai_meaning'] = df['thai_meaning'].fillna('')
    df = df[df['thai_meaning'].str.strip() != '']
    print(f"CSV rows with translation: {len(df)}")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    updated = skipped = not_found = 0

    for _, row in df.iterrows():
        chinese = str(row['chinese']).strip()
        thai = normalize_meaning(str(row['thai_meaning']).strip())

        cur.execute("SELECT id, thai_meaning FROM words WHERE chinese = %s AND thai_meaning = ''", (chinese,))
        word = cur.fetchone()

        if word is None:
            cur.execute("SELECT id FROM words WHERE chinese = %s", (chinese,))
            if cur.fetchone():
                skipped += 1
            else:
                not_found += 1
            continue

        if not args.dry_run:
            cur.execute("UPDATE words SET thai_meaning = %s, status = 'verified' WHERE id = %s", (thai, word[0]))
        updated += 1

    if not args.dry_run:
        conn.commit()
        print(f"\nDone!")
    else:
        print(f"\n[DRY RUN]")

    print(f"  Updated  : {updated}")
    print(f"  Skipped  : {skipped} (มีคำแปลแล้ว)")
    print(f"  Not found: {not_found} (ไม่มีใน DB)")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
