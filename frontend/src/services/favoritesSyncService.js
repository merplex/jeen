import db from './offlineDb'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

async function pushPending(token) {
  const pending = await db.favorites.where('_pending').equals(1).toArray()
  for (const fav of pending) {
    try {
      // toggle endpoint ทำได้ทั้ง add/remove ในครั้งเดียว
      // แต่เราต้องควบคุมทิศทาง → ใช้ status ที่ต้องการ
      const serverRes = await fetch(`${BASE_URL}/words/${fav.word_id}/favorite-status`, {
        headers: authHeaders(token),
      })
      if (!serverRes.ok) continue
      const { favorited: serverFavorited } = await serverRes.json()
      const wantFavorited = !fav._deleted

      if (wantFavorited !== serverFavorited) {
        // toggle เพื่อให้ตรงกับ local
        await fetch(`${BASE_URL}/words/${fav.word_id}/favorite`, {
          method: 'POST', headers: authHeaders(token),
        })
      }
      if (fav._deleted) {
        await db.favorites.delete(fav.word_id)
      } else {
        await db.favorites.put({ ...fav, _pending: 0, _deleted: 0 })
      }
    } catch {
      // silent
    }
  }
}

async function pullFromServer(token) {
  const res = await fetch(`${BASE_URL}/words/favorites`, { headers: authHeaders(token) })
  if (!res.ok) return
  const serverList = await res.json() // [{ word_id, ... }, ...]

  const serverWordIds = new Set(serverList.map(f => f.word_id))
  const allLocal = await db.favorites.toArray()

  // ลบ local ที่ไม่ pending และไม่อยู่ใน server
  for (const local of allLocal) {
    if (!local._pending && !serverWordIds.has(local.word_id)) {
      await db.favorites.delete(local.word_id)
    }
  }
  // upsert server records (ยกเว้น pending local)
  const pendingIds = new Set(
    (await db.favorites.where('_pending').equals(1).toArray()).map(f => f.word_id)
  )
  for (const fav of serverList) {
    if (!pendingIds.has(fav.word_id)) {
      await db.favorites.put({ word_id: fav.word_id, created_at: fav.favorited_at, _pending: 0, _deleted: 0 })
    }
  }
}

export async function startFavoritesSync(token) {
  if (!navigator.onLine || !token) return
  try {
    await pushPending(token)
    await pullFromServer(token)
  } catch {
    // silent fail
  }
}

// คืน true ถ้า word_id อยู่ใน favorites (local)
export async function isFavoritedLocal(wordId) {
  const fav = await db.favorites.get(wordId)
  return !!fav && !fav._deleted
}

// Toggle favorite ใน local (offline-safe) — คืน new state
export async function toggleFavoriteOffline(wordId) {
  const existing = await db.favorites.get(wordId)
  if (existing && !existing._deleted) {
    await db.favorites.put({ ...existing, _pending: 1, _deleted: 1 })
    return false
  } else {
    await db.favorites.put({ word_id: wordId, created_at: new Date().toISOString(), _pending: 1, _deleted: 0 })
    return true
  }
}
