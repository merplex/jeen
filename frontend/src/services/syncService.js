import db from './offlineDb'

const BATCH = 500
const CONCURRENCY = 3
const PROGRESS_KEY = 'offline_sync_progress'
// { offset: 0, total: null, synced_at: null, in_progress: false }

function getProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') } catch { return {} }
}
function saveProgress(p) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p))
}

// ดึง base URL เดียวกับ api.js
const BASE_URL = import.meta.env.VITE_API_URL || '/api'

async function fetchBatch(offset, since = null) {
  let url = `${BASE_URL}/words/sync?offset=${offset}&limit=${BATCH}`
  if (since) url += `&since=${encodeURIComponent(since)}`
  const token = localStorage.getItem('token')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`sync fetch failed: ${res.status}`)
  return res.json()
}

async function upsertBatch(words) {
  await db.words.bulkPut(words)
}

// ---- Full sync (ครั้งแรก หรือ reset) ----
async function fullSync(onProgress) {
  // ดึง total ก่อน
  const first = await fetchBatch(0)
  const total = first.total
  saveProgress({ offset: 0, total, synced_at: null, in_progress: true })

  let done = first.words.length
  await upsertBatch(first.words)
  onProgress?.(done, total)
  if (done >= total) {
    const now = new Date().toISOString()
    saveProgress({ offset: total, total, synced_at: now, in_progress: false })
    return
  }

  // ดึง batch ที่เหลือแบบ parallel (CONCURRENCY ต่อรอบ)
  let offset = BATCH
  while (offset < total) {
    const offsets = []
    for (let i = 0; i < CONCURRENCY && offset < total; i++, offset += BATCH) {
      offsets.push(offset)
    }
    const results = await Promise.all(offsets.map(o => fetchBatch(o)))
    for (const r of results) {
      await upsertBatch(r.words)
      done += r.words.length
      saveProgress({ offset: done, total, synced_at: null, in_progress: true })
      onProgress?.(done, total)
    }
  }

  const now = new Date().toISOString()
  saveProgress({ offset: total, total, synced_at: now, in_progress: false })
}

// ---- Resume sync (กรณีปิดแอปกลางคัน) ----
async function resumeSync(progress, onProgress) {
  const { offset: startOffset, total } = progress
  let done = startOffset
  let offset = startOffset

  while (offset < total) {
    const offsets = []
    for (let i = 0; i < CONCURRENCY && offset < total; i++, offset += BATCH) {
      offsets.push(offset)
    }
    const results = await Promise.all(offsets.map(o => fetchBatch(o)))
    for (const r of results) {
      await upsertBatch(r.words)
      done += r.words.length
      saveProgress({ offset: done, total, synced_at: null, in_progress: true })
      onProgress?.(done, total)
    }
  }

  const now = new Date().toISOString()
  saveProgress({ offset: total, total, synced_at: now, in_progress: false })
}

// ---- Delta sync (อัปเดตเฉพาะที่เปลี่ยน) ----
async function deltaSync(since) {
  let offset = 0
  while (true) {
    const r = await fetchBatch(offset, since)
    if (r.words.length === 0) break
    await upsertBatch(r.words)
    offset += r.words.length
    if (offset >= r.total) break
  }
  const now = new Date().toISOString()
  const p = getProgress()
  saveProgress({ ...p, synced_at: now, in_progress: false })
}

// ---- Entry point — เรียกตอน app start ----
export async function startBackgroundSync(onProgress) {
  if (!navigator.onLine) return

  const p = getProgress()

  // Delta sync (มี synced_at แล้ว)
  if (p.synced_at && !p.in_progress) {
    deltaSync(p.synced_at).catch(() => {})
    return
  }

  // Resume (ถูกปิดกลางคัน)
  if (p.in_progress && p.offset > 0 && p.total) {
    resumeSync(p, onProgress).catch(() => {})
    return
  }

  // Full sync ครั้งแรก
  fullSync(onProgress).catch(() => {})
}

export function getSyncProgress() {
  return getProgress()
}

export function isOfflineSynced() {
  return !!getProgress().synced_at
}
