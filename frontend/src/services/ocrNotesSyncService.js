import db from './offlineDb'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function fetchServerNotes(token) {
  const res = await fetch(`${BASE_URL}/ocr-notes`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('fetch ocr-notes failed')
  return res.json()
}

async function pushPending(token) {
  const pending = await db.ocr_notes.where('_pending').equals(1).toArray()
  for (const local of pending) {
    try {
      if (local._deleted) {
        if (local.id > 0) {
          await fetch(`${BASE_URL}/ocr-notes/${local.id}`, {
            method: 'DELETE', headers: authHeaders(token),
          })
        }
        await db.ocr_notes.delete(local.id)
      } else if (local.id < 0) {
        const res = await fetch(`${BASE_URL}/ocr-notes`, {
          method: 'POST', headers: authHeaders(token),
          body: JSON.stringify({
            translation_text: local.translation_text,
            translation_mode: local.translation_mode,
            lines_json: local.lines_json,
            words_json: local.words_json,
          }),
        })
        if (res.ok) {
          const created = await res.json()
          await db.ocr_notes.delete(local.id)
          await db.ocr_notes.put({ ...created, _pending: 0, _deleted: 0 })
        }
      }
    } catch {
      // silent — retry next sync
    }
  }
}

async function pullFromServer(token) {
  const serverNotes = await fetchServerNotes(token)
  for (const serverNote of serverNotes) {
    const local = await db.ocr_notes.get(serverNote.id)
    if (!local || local._pending !== 1) {
      await db.ocr_notes.put({ ...serverNote, _pending: 0, _deleted: 0 })
    } else {
      const serverTime = new Date(serverNote.updated_at).getTime()
      const localTime = new Date(local.updated_at).getTime()
      if (serverTime > localTime) {
        await db.ocr_notes.put({ ...serverNote, _pending: 0, _deleted: 0 })
      }
    }
  }
  const serverIds = new Set(serverNotes.map(n => n.id))
  const allLocal = await db.ocr_notes.toArray()
  for (const local of allLocal) {
    if (local.id > 0 && !serverIds.has(local.id) && !local._pending) {
      await db.ocr_notes.delete(local.id)
    }
  }
}

export async function startOcrNotesSync(token) {
  if (!navigator.onLine || !token) return
  try {
    await pushPending(token)
    await pullFromServer(token)
  } catch {
    // silent fail
  }
}

export async function saveOcrNoteOffline({ translationText, translationMode, linesJson, wordsJson }) {
  const now = new Date().toISOString()
  const tempId = -Date.now()
  const note = {
    id: tempId,
    translation_text: translationText,
    translation_mode: translationMode,
    lines_json: linesJson,
    words_json: wordsJson,
    created_at: now,
    updated_at: now,
    _pending: 1,
    _deleted: 0,
  }
  await db.ocr_notes.put(note)
  return note
}

export async function deleteOcrNoteOffline(id) {
  if (id < 0) {
    await db.ocr_notes.delete(id)
  } else {
    await db.ocr_notes.update(id, { _deleted: 1, _pending: 1 })
  }
}
