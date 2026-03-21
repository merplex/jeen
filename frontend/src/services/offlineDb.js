import Dexie from 'dexie'

const db = new Dexie('jeenDict')

db.version(1).stores({
  words: 'id, chinese, chinese_traditional, pinyin_plain, char_count, updated_at',
})

export default db

// ค้นหาแบบออฟไลน์ — คืน result object เหมือน backend
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
