import db from './offlineDb'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// id ใน local = "wordId_deck"
function localId(wordId, deck) {
  return `${wordId}_${deck}`
}

// Push pending adds/removes ขึ้น server
async function pushPending(token) {
  const pending = await db.flashcards.where('_pending').equals(1).toArray()
  for (const fc of pending) {
    try {
      if (fc._deleted) {
        await fetch(`${BASE_URL}/flashcards/${fc.word_id}?deck=${fc.deck}`, {
          method: 'DELETE', headers: authHeaders(token),
        })
        await db.flashcards.delete(fc.id)
      } else {
        await fetch(`${BASE_URL}/flashcards/${fc.word_id}?deck=${fc.deck}`, {
          method: 'POST', headers: authHeaders(token),
        })
        await db.flashcards.put({ ...fc, _pending: 0, _deleted: 0 })
      }
    } catch {
      // silent — retry ครั้งถัดไป
    }
  }
}

// Pull flashcards ทั้งหมดจาก server แล้วแทนทับ local (ที่ไม่ pending)
async function pullFromServer(token) {
  const res = await fetch(`${BASE_URL}/flashcards`, { headers: authHeaders(token) })
  if (!res.ok) return
  const serverList = await res.json() // [{ id, word_id, deck, added_at }, ...]

  // ลบ local ที่ไม่ pending และไม่อยู่ใน server
  const serverKeys = new Set(serverList.map(fc => localId(fc.word_id, fc.deck)))
  const allLocal = await db.flashcards.toArray()
  for (const local of allLocal) {
    if (!local._pending && !serverKeys.has(local.id)) {
      await db.flashcards.delete(local.id)
    }
  }
  // upsert server records (ยกเว้น pending local)
  const pendingIds = new Set(
    (await db.flashcards.where('_pending').equals(1).toArray()).map(fc => fc.id)
  )
  for (const fc of serverList) {
    const lid = localId(fc.word_id, fc.deck)
    if (!pendingIds.has(lid)) {
      await db.flashcards.put({ id: lid, word_id: fc.word_id, deck: fc.deck, added_at: fc.added_at, _pending: 0, _deleted: 0 })
    }
  }
}

export async function startFlashcardSync(token) {
  if (!navigator.onLine || !token) return
  try {
    await pushPending(token)
    await pullFromServer(token)
  } catch {
    // silent fail
  }
}

// คืน Set ของ deck ที่คำนี้อยู่ (จาก local)
export async function getLocalDecks(wordId) {
  const rows = await db.flashcards
    .where('word_id').equals(wordId)
    .filter(fc => !fc._deleted)
    .toArray()
  return new Set(rows.map(fc => fc.deck))
}

// Toggle deck ใน local (offline-safe)
export async function toggleDeckOffline(wordId, deck) {
  const id = localId(wordId, deck)
  const existing = await db.flashcards.get(id)
  if (existing && !existing._deleted) {
    await db.flashcards.put({ ...existing, _pending: 1, _deleted: 1 })
    return false // removed
  } else {
    await db.flashcards.put({ id, word_id: wordId, deck, added_at: new Date().toISOString(), _pending: 1, _deleted: 0 })
    return true // added
  }
}
