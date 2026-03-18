"""
translate_hsk7.py — ดึงคำ HSK7 ที่ยังไม่มีคำแปลจาก DB → แปลด้วย Gemini → บันทึกเป็น hsk7_withThai.csv
Usage:
  DATABASE_URL="postgresql://..." GEMINI_API_KEY="..." python3 translate_hsk7.py
"""

import os
import json
import time
import requests
import psycopg2
import csv

# ===== CONFIG =====
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    GEMINI_API_KEY = input("Enter Gemini API Key: ").strip()

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://dictuser:dictpass@localhost:5432/thaidict")
DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "hsk7_withThai.csv")
BATCH_SIZE = 400
# ==================

# ดึงคำ HSK7 ที่ยังไม่มีคำแปลจาก DB
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
cur.execute("""
    SELECT chinese, category, hsk_level
    FROM words
    WHERE hsk_level = 'hsk7'
      AND (thai_meaning IS NULL OR thai_meaning = '')
      AND status = 'verified'
    ORDER BY id
""")
rows = cur.fetchall()
cur.close()
conn.close()

words = [r[0] for r in rows]
categories = [r[1] or '' for r in rows]
hsk_levels = [r[2] or 'HSK7' for r in rows]
print(f"Total HSK7 words to translate: {len(words)}")


def translate_batch(batch_words):
    word_list = "\n".join([f"{i+1}. {w}" for i, w in enumerate(batch_words)])

    prompt = f"""คุณเป็นผู้เชี่ยวชาญภาษาจีน-ไทย แปลคำศัพท์จีนต่อไปนี้เป็นภาษาไทย

กฎการแปล:
- ถ้าคำมีความหมายเดียวกันแต่พูดต่างกันได้ ให้ใส่ทุกแบบโดยคั่นด้วย ", " (คอมม่า+เว้นวรรค)
  ตัวอย่าง: 高兴 → ดีใจ, ยินดี, มีความสุข
- ถ้าคำมีหลายความหมายที่ต่างกัน ให้ใส่ทุกความหมายโดยคั่นด้วย " ; " (เว้นวรรค+เซมิโคลอน+เว้นวรรค)
  ตัวอย่าง: 打 → ตี, ชก, ต่อย ; โทรศัพท์ (โทร) ; เล่น (กีฬา)
- พยายามใส่คำแปลไทยมากกว่า 1 ลักษณะการพูดเสมอ (ความหมายเดียวกัน คำต่างกัน)
- ถ้าเป็น particle/อนุภาคภาษาจีน ให้อธิบายหน้าที่สั้นๆ
- ตอบเฉพาะคำแปลเท่านั้น ไม่ต้องมีคำอธิบายเพิ่ม
- ตอบในรูปแบบ JSON array เท่านั้น เช่น ["คำแปล1", "คำแปล2", ...]
- จำนวน element ใน array ต้องเท่ากับจำนวนคำที่ให้แปลเสมอ ({len(batch_words)} คำ)

คำศัพท์ที่ต้องแปล:
{word_list}

ตอบเป็น JSON array เท่านั้น ไม่ต้องมีข้อความอื่น"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 16384}
    }
    headers = {"Content-Type": "application/json"}
    url = f"{GEMINI_URL}?key={GEMINI_API_KEY}"

    resp = requests.post(url, headers=headers, json=payload, timeout=180)
    resp.raise_for_status()

    data = resp.json()
    text = data['candidates'][0]['content']['parts'][0]['text'].strip()

    if text.startswith("```"):
        lines = text.split('\n')
        text = '\n'.join(lines[1:-1])

    return json.loads(text)


# Resume support: load existing output if exists
all_translations = [''] * len(words)
if os.path.exists(OUTPUT_FILE):
    with open(OUTPUT_FILE, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        existing = {row['chinese']: row['thai_meaning'] for row in reader}
    for i, w in enumerate(words):
        if w in existing and existing[w].strip():
            all_translations[i] = existing[w]
    filled = sum(1 for t in all_translations if t.strip())
    print(f"Resuming: {filled}/{len(words)} already translated")


def save_csv():
    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['chinese', 'thai_meaning', 'category', 'hsk_level'])
        for i, w in enumerate(words):
            writer.writerow([w, all_translations[i], categories[i], hsk_levels[i]])


total_batches = (len(words) + BATCH_SIZE - 1) // BATCH_SIZE

for batch_num in range(total_batches):
    start = batch_num * BATCH_SIZE
    end = min(start + BATCH_SIZE, len(words))
    batch = words[start:end]

    # skip only if ALL words in batch have non-empty translations
    batch_done = all(all_translations[i].strip() for i in range(start, end))
    if batch_done:
        print(f"Batch {batch_num+1}/{total_batches} already done, skipping...")
        continue

    # partial batch: translate only missing words, fill back in
    missing_indices = [i for i in range(start, end) if not all_translations[i].strip()]
    if len(missing_indices) < len(batch):
        print(f"Batch {batch_num+1}/{total_batches} partial ({len(missing_indices)} missing)...", end=' ', flush=True)
        missing_words = [words[i] for i in missing_indices]
        for attempt in range(3):
            try:
                translations = translate_batch(missing_words)
                if len(translations) == len(missing_words):
                    for idx, trans in zip(missing_indices, translations):
                        all_translations[idx] = trans
                    print("✓")
                    save_csv()
                    break
                else:
                    raise ValueError(f"Length mismatch: got {len(translations)}, expected {len(missing_words)}")
            except Exception as e:
                print(f"\n  ✗ Attempt {attempt+1}/3: {e}")
                if attempt < 2:
                    time.sleep(5)
                else:
                    print(f"  Skipping partial batch {batch_num+1}")
        if batch_num < total_batches - 1:
            time.sleep(2)
        continue

    print(f"Batch {batch_num+1}/{total_batches} (words {start+1}-{end})...", end=' ', flush=True)

    success = False
    for attempt in range(3):
        try:
            translations = translate_batch(batch)
            if len(translations) == len(batch):
                all_translations[start:end] = translations
                print("✓")
                save_csv()
                success = True
                break
            else:
                raise ValueError(f"Length mismatch: got {len(translations)}, expected {len(batch)}")
        except Exception as e:
            print(f"\n  ✗ Attempt {attempt+1}/3: {e}")
            if attempt < 2:
                time.sleep(5)

    if not success:
        # fallback: แตกเป็น sub-batch ขนาด 50
        print(f"  Fallback: แตกเป็น sub-batches ขนาด 50...")
        SUB = 50
        sub_batches = [(i, min(i + SUB, len(batch))) for i in range(0, len(batch), SUB)]
        for sb_start, sb_end in sub_batches:
            sb = batch[sb_start:sb_end]
            for attempt in range(3):
                try:
                    trans = translate_batch(sb)
                    if len(trans) == len(sb):
                        for j, t in enumerate(trans):
                            all_translations[start + sb_start + j] = t
                        save_csv()
                        print(f"    sub {sb_start+1}-{sb_end} ✓")
                        break
                    else:
                        raise ValueError(f"got {len(trans)}, expected {len(sb)}")
                except Exception as e:
                    print(f"    sub {sb_start+1}-{sb_end} ✗ attempt {attempt+1}: {e}")
                    if attempt < 2:
                        time.sleep(5)
            time.sleep(1)

    if batch_num < total_batches - 1:
        time.sleep(2)

save_csv()
print(f"\nDone! Saved to {OUTPUT_FILE}")
print(f"Translated: {sum(1 for t in all_translations if t.strip())}/{len(words)}")
