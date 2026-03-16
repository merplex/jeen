"""
HSK Thai Translation Script
รัน: GEMINI_API_KEY="your_key" python3 translate_hsk.py
หรือ: python3 translate_hsk.py  (แล้วจะถามหา key)
"""

import pandas as pd
import requests
import json
import time
import os

# ===== CONFIG =====
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    GEMINI_API_KEY = input("Enter Gemini API Key: ").strip()

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"
INPUT_FILE = "export1_20260316_hsk_noThai.csv"
OUTPUT_FILE = "hsk_with_thai.csv"
BATCH_SIZE = 50
# ==================

df = pd.read_csv(INPUT_FILE, dtype=str)
df['thai_meaning'] = df['thai_meaning'].fillna('')
words = df['chinese'].tolist()
print(f"Total words: {len(words)}")

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
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192}
    }
    headers = {"Content-Type": "application/json"}
    url = f"{GEMINI_URL}?key={GEMINI_API_KEY}"

    resp = requests.post(url, headers=headers, json=payload, timeout=120)
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
    existing = pd.read_csv(OUTPUT_FILE, dtype=str)
    existing['thai_meaning'] = existing['thai_meaning'].fillna('')
    if len(existing) == len(df):
        all_translations = existing['thai_meaning'].tolist()
        filled = sum(1 for t in all_translations if t.strip())
        print(f"Resuming: {filled}/{len(words)} already translated")

total_batches = (len(words) + BATCH_SIZE - 1) // BATCH_SIZE

for batch_num in range(total_batches):
    start = batch_num * BATCH_SIZE
    end = min(start + BATCH_SIZE, len(words))
    batch = words[start:end]

    batch_done = all(all_translations[i].strip() for i in range(start, end))
    if batch_done:
        print(f"Batch {batch_num+1}/{total_batches} already done, skipping...")
        continue

    print(f"Batch {batch_num+1}/{total_batches} (words {start+1}-{end})...", end=' ', flush=True)

    for attempt in range(3):
        try:
            translations = translate_batch(batch)
            if len(translations) == len(batch):
                all_translations[start:end] = translations
                print("✓")
                df['thai_meaning'] = all_translations
                df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')
                break
            else:
                raise ValueError(f"Length mismatch: got {len(translations)}, expected {len(batch)}")
        except Exception as e:
            print(f"\n  ✗ Attempt {attempt+1}/3: {e}")
            if attempt < 2:
                time.sleep(5)
            else:
                print(f"  Skipping batch {batch_num+1}")

    if batch_num < total_batches - 1:
        time.sleep(1.5)

df['thai_meaning'] = all_translations
df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')
print(f"\nDone! Saved to {OUTPUT_FILE}")
print(f"\nSample:")
print(df.head(15).to_string(index=False))
