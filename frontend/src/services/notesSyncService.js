import db from './offlineDb'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ดึงโน้ตทั้งหมดของ user จาก server
async function fetchServerNotes(token) {
  const res = await fetch(`${BASE_URL}/notes`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error('fetch notes failed')
  return res.json() // array of { id, word_id, note_text, updated_at, ... }
}

// Push pending notes ขึ้น server (last-write-wins)
async function pushPending(token) {
  const pending = await db.notes.where('_pending').equals(1).toArray()
  for (const local of pending) {
    try {
      if (local._deleted) {
        // ลบจาก server ถ้ามี server id จริง
        if (local.id > 0) {
          await fetch(`${BASE_URL}/notes/${local.id}`, {
            method: 'DELETE', headers: authHeaders(token),
          })
        }
        await db.notes.delete(local.id)
      } else if (local.id < 0) {
        // สร้างใหม่ (temp id)
        const res = await fetch(`${BASE_URL}/notes`, {
          method: 'POST', headers: authHeaders(token),
          body: JSON.stringify({ word_id: local.word_id, note_text: local.note_text }),
        })
        if (res.ok) {
          const created = await res.json()
          await db.notes.delete(local.id) // ลบ temp
          await db.notes.put({ ...created, _pending: 0, _deleted: 0 })
        }
      } else {
        // update — ตรวจสอบ conflict กับ server ก่อน
        const serverRes = await fetch(`${BASE_URL}/notes`, { headers: authHeaders(token) })
        if (serverRes.ok) {
          const allServer = await serverRes.json()
          const serverNote = allServer.find(n => n.id === local.id)
          if (serverNote) {
            const serverTime = new Date(serverNote.updated_at).getTime()
            const localTime = new Date(local.updated_at).getTime()
            if (localTime >= serverTime) {
              // local ใหม่กว่า → push
              const res = await fetch(`${BASE_URL}/notes/${local.id}`, {
                method: 'PUT', headers: authHeaders(token),
                body: JSON.stringify({ note_text: local.note_text }),
              })
              if (res.ok) {
                const updated = await res.json()
                await db.notes.put({ ...updated, _pending: 0, _deleted: 0 })
              }
            } else {
              // server ใหม่กว่า → discard local, เอา server
              await db.notes.put({ ...serverNote, _pending: 0, _deleted: 0 })
            }
          }
        }
      }
    } catch {
      // ถ้า push ล้มเหลว ปล่อยไว้ pending รอ sync ครั้งหน้า
    }
  }
}

// Pull โน้ตจาก server — merge กับ local (last-write-wins)
async function pullFromServer(token) {
  const serverNotes = await fetchServerNotes(token)
  for (const serverNote of serverNotes) {
    const local = await db.notes.get(serverNote.id)
    if (!local || local._pending !== 1) {
      // ไม่มี local หรือ local ไม่ได้ pending → เอา server
      await db.notes.put({ ...serverNote, _pending: 0, _deleted: 0 })
    } else {
      // มี local pending → เปรียบ timestamp
      const serverTime = new Date(serverNote.updated_at).getTime()
      const localTime = new Date(local.updated_at).getTime()
      if (serverTime > localTime) {
        // server ใหม่กว่า → เอา server, ยกเลิก pending
        await db.notes.put({ ...serverNote, _pending: 0, _deleted: 0 })
      }
      // local ใหม่กว่า → ปล่อย pending ไว้ (จะ push ในรอบถัดไป)
    }
  }
  // ลบ local notes ที่ server ไม่มีแล้ว (ถูกลบจากเครื่องอื่น) และไม่ใช่ temp
  const serverIds = new Set(serverNotes.map(n => n.id))
  const allLocal = await db.notes.toArray()
  for (const local of allLocal) {
    if (local.id > 0 && !serverIds.has(local.id) && !local._pending) {
      await db.notes.delete(local.id)
    }
  }
}

// Entry point — เรียกตอน online
export async function startNotesSync(token) {
  if (!navigator.onLine || !token) return
  try {
    await pushPending(token)
    await pullFromServer(token)
  } catch {
    // silent fail — จะ retry ครั้งถัดไป
  }
}

// บันทึกโน้ตลง local (offline-safe) — คืน note object
export async function saveNoteOffline({ existingNote, wordId, noteText }) {
  const now = new Date().toISOString()
  if (existingNote) {
    const updated = { ...existingNote, note_text: noteText, updated_at: now, _pending: 1, _deleted: 0 }
    await db.notes.put(updated)
    return updated
  } else {
    const tempId = -Date.now()
    const created = { id: tempId, word_id: wordId, note_text: noteText, updated_at: now, _pending: 1, _deleted: 0 }
    await db.notes.put(created)
    return created
  }
}

// โหลดโน้ตของคำนี้จาก local
export async function getNoteOffline(wordId) {
  return db.notes.where('word_id').equals(wordId).first()
}
