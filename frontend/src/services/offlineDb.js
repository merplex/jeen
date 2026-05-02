import Dexie from 'dexie'

const db = new Dexie('jeenDict')

db.version(1).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, updated_at',
})

db.version(2).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, hsk_level, updated_at',
})

// version 3: เพิ่ม notes table
// id: server id (>0) หรือ temp id (<0) สำหรับโน้ตที่สร้างตอน offline
// _pending: 1=รอ sync, 0=synced
// _deleted: 1=รอลบจาก server
db.version(3).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, hsk_level, updated_at',
  notes: 'id, word_id, updated_at, _pending',
})

// version 4: เพิ่ม flashcards + favorites tables
// flashcards key: [word_id, deck] composite → ใช้ string "wordId_deck" เป็น id
// favorites key: word_id
db.version(4).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, hsk_level, updated_at',
  notes: 'id, word_id, updated_at, _pending',
  flashcards: 'id, word_id, deck, _pending',
  favorites: 'word_id, _pending',
})

// version 5: เพิ่ม search_history table (local only, ไม่ sync ขึ้น server)
// เก็บแค่ 100 รายการล่าสุด
db.version(5).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, hsk_level, updated_at',
  notes: 'id, word_id, updated_at, _pending',
  flashcards: 'id, word_id, deck, _pending',
  favorites: 'word_id, _pending',
  search_history: '++id, searched_at',
})

// version 6: เพิ่ม ocr_notes — บันทึกผลแปล OCR + คำศัพท์ที่พบ
// id: server id (>0) หรือ temp id (<0) สำหรับโน้ตที่สร้างตอน offline
db.version(6).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, hsk_level, updated_at',
  notes: 'id, word_id, updated_at, _pending',
  flashcards: 'id, word_id, deck, _pending',
  favorites: 'word_id, _pending',
  search_history: '++id, searched_at',
  ocr_notes: 'id, updated_at, _pending',
})

export default db

// ค้นหาแบบออฟไลน์ — คืน result object เหมือน backend
const MAX_LOCAL_HISTORY = 100

export async function recordLocalHistory({ query, result_word_id = null, result_word_pinyin = null, found = false }) {
  // ลบรายการเดิมที่ซ้ำก่อน แล้วเพิ่มใหม่บนสุด
  if (result_word_id) {
    const existing = await db.search_history.filter(h => h.result_word_id === result_word_id).toArray()
    await db.search_history.bulkDelete(existing.map(h => h.id))
  } else {
    const existing = await db.search_history.filter(h => h.query === query && !h.result_word_id).toArray()
    await db.search_history.bulkDelete(existing.map(h => h.id))
  }
  await db.search_history.add({ query, result_word_id, result_word_pinyin, found, searched_at: new Date().toISOString() })
  const count = await db.search_history.count()
  if (count > MAX_LOCAL_HISTORY) {
    const oldest = await db.search_history.orderBy('id').limit(count - MAX_LOCAL_HISTORY).primaryKeys()
    await db.search_history.bulkDelete(oldest)
  }
}

export async function getLocalHistory() {
  return db.search_history.orderBy('id').reverse().limit(MAX_LOCAL_HISTORY).toArray()
}

export async function deleteLocalHistory(id) {
  return db.search_history.delete(id)
}

export async function offlineSearch(query) {
  query = query.trim()
  if (!query) return { found: false, prefix_group: [], inner_group: [], total: 0, query }

  const isChinese = /[\u4e00-\u9fff]/.test(query)
  const isThai = /[\u0e00-\u0e7f]/.test(query)

  let prefixResults = []
  let innerResults = []

  if (isChinese) {
    // ค้นหาจาก chinese และ chinese_traditional
    const allWords = await db.words
      .filter(w =>
        (w.chinese && w.chinese.startsWith(query)) ||
        (w.chinese_traditional && w.chinese_traditional.startsWith(query))
      )
      .sortBy('char_count')
    prefixResults = allWords.slice(0, 80)
    const prefixIds = new Set(prefixResults.map(w => w.id))
    innerResults = (await db.words
      .filter(w =>
        !prefixIds.has(w.id) &&
        ((w.chinese && w.chinese.includes(query)) ||
         (w.chinese_traditional && w.chinese_traditional.includes(query)))
      )
      .sortBy('char_count')).slice(0, 80)
  } else if (isThai) {
    const allWords = await db.words
      .filter(w => w.thai_meaning && w.thai_meaning.includes(query))
      .sortBy('char_count')
    prefixResults = allWords.filter(w => w.thai_meaning.startsWith(query)).slice(0, 80)
    const prefixIds = new Set(prefixResults.map(w => w.id))
    innerResults = allWords.filter(w => !prefixIds.has(w.id)).slice(0, 80)
  } else {
    // pinyin
    const q = query.toLowerCase().replace(/\s/g, '')
    const allWords = await db.words
      .filter(w => w.pinyin_plain && w.pinyin_plain.replace(/\s/g, '').toLowerCase().includes(q))
      .sortBy('char_count')
    prefixResults = allWords.filter(w => w.pinyin_plain.replace(/\s/g, '').toLowerCase().startsWith(q)).slice(0, 80)
    const prefixIds = new Set(prefixResults.map(w => w.id))
    innerResults = allWords.filter(w => !prefixIds.has(w.id)).slice(0, 80)
  }

  const total = prefixResults.length + innerResults.length
  return {
    query,
    found: total > 0,
    prefix_group: prefixResults,
    inner_group: innerResults,
    total,
    offline: true,
  }
}
