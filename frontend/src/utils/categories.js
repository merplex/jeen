export const CATEGORIES = [
  'ทั่วไป', 'ชีวิตประจำวัน', 'อาหาร', 'สัตว์', 'สถานที่', 'ครอบครัว',
  'บุคคล', 'ร่างกาย', 'การงาน', 'การเดินทาง', 'กีฬา', 'แพทย์',
  'วิศวกรรม', 'เทคนิค', 'ธุรกิจ', 'กฎหมาย', 'สำนวน', 'พิเศษ',
]

// สำหรับ Search filter (มี "ทั้งหมด" นำหน้า)
export const SEARCH_CATEGORIES = ['ทั้งหมด', ...CATEGORIES]

// สีหลักตามหมวด
const NAMED_COLORS = {
  'สถานที่':      '#6d28d9', // purple
  'อาหาร':        '#15803d', // dark green
  'แพทย์':        '#dc2626', // red
  'ชีวิตประจำวัน': '#a16207', // dark yellow
  'สำนวน':        '#1f2937', // black
  'กีฬา':         '#c2410c', // orange
  'สัตว์':        '#78350f', // brown
}

// สีสำรองสำหรับหมวดที่เหลือ (deterministic by index)
const FALLBACK_COLORS = [
  '#0369a1', '#0f766e', '#7c3aed', '#be185d',
  '#065f46', '#1d4ed8', '#9a3412', '#475569',
]

export function getCategoryColor(cat) {
  if (NAMED_COLORS[cat]) return NAMED_COLORS[cat]
  const idx = CATEGORIES.indexOf(cat)
  return FALLBACK_COLORS[((idx >= 0 ? idx : 0)) % FALLBACK_COLORS.length]
}

export const FAV_CAT_KEY = 'fav_categories'

export function loadFavCategories() {
  try { return JSON.parse(localStorage.getItem(FAV_CAT_KEY) || '[]') } catch { return [] }
}

export function saveFavCategories(list) {
  localStorage.setItem(FAV_CAT_KEY, JSON.stringify(list))
}
