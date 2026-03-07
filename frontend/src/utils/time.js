// datetime จาก API อาจเป็น naive string (Bangkok time ไม่มี suffix)
// หรือ timezone-aware string (UTC+00:00) → ทั้งคู่ normalize เป็น Bangkok time
function _parse(str) {
  if (!str) return null
  // ถ้าไม่มี timezone suffix → ถือว่าเป็น UTC (PostgreSQL server คืน UTC naive)
  const s = str.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(str) ? str : str + 'Z'
  return new Date(s)
}

export function thaiDateTime(str) {
  const d = _parse(str)
  if (!d) return ''
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
}

export function thaiRelativeTime(str) {
  const d = _parse(str)
  if (!d) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'เมื่อกี้'
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`
  return `${Math.floor(diff / 86400)} วันที่แล้ว`
}
