import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteNote } from '../services/api'
import useAuthStore from '../stores/authStore'
import { thaiDateTime } from '../utils/time'
import TonedChinese from '../components/TonedChinese'
import db from '../services/offlineDb'
import { deleteOcrNoteOffline } from '../services/ocrNotesSyncService'

export default function Notes() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [notes, setNotes] = useState([])
  const [ocrNotes, setOcrNotes] = useState([])
  const [search, setSearch] = useState('')

  const loadNotes = async (q = '') => {
    const all = await db.notes.filter(n => !n._deleted).toArray()
    const wordIds = [...new Set(all.map(n => n.word_id))]
    const words = await db.words.where('id').anyOf(wordIds).toArray()
    const wordMap = Object.fromEntries(words.map(w => [w.id, w]))
    let result = all.map(n => ({ ...n, word: wordMap[n.word_id] ?? null }))
    if (q) {
      const lower = q.toLowerCase()
      result = result.filter(n =>
        n.note_text?.toLowerCase().includes(lower) ||
        n.word?.chinese?.includes(q) ||
        n.word?.pinyin?.toLowerCase().includes(lower)
      )
    }
    result.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    setNotes(result)
  }

  const loadOcrNotes = async (q = '') => {
    let result = await db.ocr_notes.filter(n => !n._deleted).toArray()
    if (q) {
      const lower = q.toLowerCase()
      result = result.filter(n => {
        if (n.translation_text?.toLowerCase().includes(lower)) return true
        if (n.words_json) {
          try {
            const ws = JSON.parse(n.words_json)
            return ws.some(w =>
              w.chinese?.includes(q) ||
              w.pinyin?.toLowerCase().includes(lower) ||
              w.thai_meaning?.toLowerCase().includes(lower)
            )
          } catch { return false }
        }
        return false
      })
    }
    result.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    setOcrNotes(result)
  }

  useEffect(() => {
    if (!user) return
    loadNotes()
    loadOcrNotes()
  }, [user])

  const handleSearch = (e) => {
    const v = e.target.value
    setSearch(v)
    loadNotes(v)
    loadOcrNotes(v)
  }

  const remove = async (id) => {
    if (id < 0) {
      await db.notes.delete(id)
    } else {
      await db.notes.update(id, { _deleted: 1, _pending: 1 })
      deleteNote(id).catch(() => {})
    }
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  const removeOcrNote = async (id) => {
    await deleteOcrNoteOffline(id)
    setOcrNotes((n) => n.filter((x) => x.id !== id))
  }

  if (!user) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center pb-24">
      <div className="text-center">
        <p className="text-gray-500">กรุณาเข้าสู่ระบบก่อน</p>
        <button onClick={() => navigate('/login')} className="mt-4 bg-chinese-red text-white px-6 py-2 rounded-xl">
          เข้าสู่ระบบ
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="text-white text-xl font-bold">โน้ตของฉัน</h1>
        <input
          value={search}
          onChange={handleSearch}
          placeholder="ค้นหาในโน้ต..."
          className="mt-3 w-full rounded-xl px-4 py-2.5 text-gray-800 bg-white/90 focus:outline-none"
        />
      </div>
      <div className="px-4 py-4 space-y-3">

        {/* OCR Notes */}
        {ocrNotes.length > 0 && (
          <>
            <p className="text-xs text-gray-400 font-medium px-1">บันทึกจาก OCR ({ocrNotes.length})</p>
            {ocrNotes.map((note) => {
              let parsedWords = []
              try { parsedWords = note.words_json ? JSON.parse(note.words_json) : [] } catch {}
              return (
                <div key={note.id} className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-chinese-red/30">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-white bg-chinese-red/70 rounded-full px-2 py-0.5">
                          {note.translation_mode === 'chat' ? 'สนทนา' : 'ทั่วไป'}
                        </span>
                        <span className="text-xs text-gray-300">{thaiDateTime(note.updated_at)}</span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-4 whitespace-pre-wrap leading-snug">
                        {note.translation_text}
                      </p>
                      {parsedWords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {parsedWords.map((w, i) => (
                            <button
                              key={i}
                              onClick={() => navigate(`/word/${w.id}`)}
                              className="font-chinese text-xs text-chinese-red bg-chinese-red/10 rounded-lg px-2 py-0.5"
                            >
                              {w.chinese}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => removeOcrNote(note.id)} className="text-gray-300 hover:text-red-400 text-xl shrink-0">
                      ×
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* Word Notes */}
        {notes.length > 0 && (
          <>
            {ocrNotes.length > 0 && <p className="text-xs text-gray-400 font-medium px-1 pt-2">โน้ตคำศัพท์ ({notes.length})</p>}
            {notes.map((note) => (
              <div key={note.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex justify-between items-start gap-2">
                  <button
                    onClick={() => navigate(`/word/${note.word_id}`)}
                    className="text-left flex-1"
                  >
                    <TonedChinese chinese={note.word?.chinese} pinyin={note.word?.pinyin} className="font-chinese text-xl" />
                    <div className="text-sm text-gray-500">{note.word?.pinyin}</div>
                    <div className="text-gray-700 text-sm mt-2 whitespace-pre-wrap line-clamp-3">
                      {note.note_text}
                    </div>
                    <div className="text-xs text-gray-300 mt-2">
                      {thaiDateTime(note.updated_at)}
                    </div>
                  </button>
                  <button onClick={() => remove(note.id)} className="text-gray-300 hover:text-red-400 text-xl">
                    ×
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {notes.length === 0 && ocrNotes.length === 0 && (
          <div className="text-center text-gray-400 py-16">
            <div className="text-5xl mb-4">📝</div>
            <p>ยังไม่มีโน้ต</p>
            <p className="text-sm mt-1">เพิ่มโน้ตได้จากหน้ารายละเอียดคำศัพท์ หรือบันทึกจาก OCR</p>
          </div>
        )}
      </div>
    </div>
  )
}
