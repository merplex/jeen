import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getWord, addFlashcard, removeFlashcard, getFlashcards, getNotes, createNote, updateNote, adminUpdateWord, adminGenerateExamples, recordSearchHistory } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function WordDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [word, setWord] = useState(null)
  const [isFav, setIsFav] = useState(false)
  const [note, setNote] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [editData, setEditData] = useState(null) // null = ไม่ได้ edit
  const [editSaving, setEditSaving] = useState(false)
  const [genExLoading, setGenExLoading] = useState(false)

  useEffect(() => {
    getWord(id)
      .then((r) => {
        setWord(r.data)
        if (user) {
          recordSearchHistory(r.data.chinese, Number(id), true).catch(() => {})
        }
      })
      .catch(() => navigate('/'))
    if (user) {
      getFlashcards().then((r) => {
        setIsFav(r.data.some((f) => f.word_id === Number(id)))
      })
      getNotes().then((r) => {
        const n = r.data.find((n) => n.word_id === Number(id))
        if (n) { setNote(n); setNoteText(n.note_text) }
      })
    }
  }, [id, user])

  const toggleFav = async () => {
    if (!user) return navigate('/login')
    if (isFav) {
      await removeFlashcard(id)
      setIsFav(false)
    } else {
      await addFlashcard(id)
      setIsFav(true)
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    if (note) {
      const r = await updateNote(note.id, { note_text: noteText })
      setNote(r.data)
    } else {
      const r = await createNote({ word_id: Number(id), note_text: noteText })
      setNote(r.data)
    }
    setEditingNote(false)
  }

  const startEdit = () => {
    setEditData({
      pinyin: word.pinyin || '',
      thai_meaning: word.thai_meaning || '',
      english_meaning: word.english_meaning || '',
      category: word.category || '',
    })
  }

  const saveEdit = async () => {
    setEditSaving(true)
    try {
      const payload = {
        pinyin: editData.pinyin || undefined,
        thai_meaning: editData.thai_meaning || undefined,
        english_meaning: editData.english_meaning || null,
        category: editData.category || null,
      }
      const r = await adminUpdateWord(id, payload)
      setWord(r.data)
      setEditData(null)
    } catch (e) {
      alert(e.response?.data?.detail || 'บันทึกไม่สำเร็จ')
    }
    setEditSaving(false)
  }

  const generateExamples = async () => {
    setGenExLoading(true)
    try {
      const r = await adminGenerateExamples(id)
      setWord(r.data)
    } catch (e) {
      alert(e.response?.data?.detail || 'สร้างตัวอย่างไม่สำเร็จ')
    }
    setGenExLoading(false)
  }

  const speak = (text) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  if (!word) return (
    <div className="flex items-center justify-center min-h-screen bg-chinese-cream">
      <div className="text-gray-400">กำลังโหลด...</div>
    </div>
  )

  const getExampleLabel = (type) => {
    if (!type) return ''
    if (type === 'formal' || type === 'written') return 'บทความ/หนังสือ'
    if (type.startsWith('conv_')) return `สนทนา ${parseInt(type.slice(5), 10) + 1}`
    // legacy
    const legacy = { daily_1: 'ชีวิตประจำวัน 1', daily_2: 'ชีวิตประจำวัน 2', common: 'ทั่วไป', spoken: 'พูด' }
    return legacy[type] || type
  }

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-6 relative">
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-12 text-white text-2xl"
        >
          ←
        </button>
        <div className="text-center">
          <div className="font-chinese text-5xl text-white mb-2">{word.chinese}</div>
          <div className="text-chinese-gold text-lg">{word.pinyin}</div>
        </div>
        <div className="absolute right-4 top-12 flex gap-3">
          <button onClick={() => speak(word.chinese)} className="text-white text-2xl" title="ออกเสียง">
            🔊
          </button>
          <button onClick={toggleFav} className="text-2xl" title="เพิ่ม Flashcard">
            {isFav ? '⭐' : '☆'}
          </button>
        </div>
      </div>

      <div className="px-4 py-6 space-y-4">
        {/* Meanings */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {word.category && (
              <span className="text-xs bg-chinese-gold/20 text-chinese-gold px-2 py-0.5 rounded-full">
                {word.category}
              </span>
            )}
            {user?.is_admin && word.source === 'ai_daily' && (
              <span className="text-[10px] bg-orange-100 text-orange-500 px-1.5 py-0.5 rounded-full font-medium">🤖 AI</span>
            )}
            {user?.is_admin && word.source === 'import' && (
              <span className="text-[10px] bg-blue-100 text-blue-500 px-1.5 py-0.5 rounded-full font-medium">📥 นำเข้า</span>
            )}
            {user?.is_admin && word.admin_edited && (
              <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-medium">✓ แก้แล้ว</span>
            )}
          </div>
          <div className="mb-3">
            <div className="text-xs text-gray-400 mb-1">ภาษาไทย</div>
            <div className="text-gray-800 text-base space-y-1">
              {word.thai_meaning.split('\n').filter((l) => l.trim()).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
          {word.english_meaning && (
            <div>
              <div className="text-xs text-gray-400 mb-1">English</div>
              <div className="text-gray-600">{word.english_meaning}</div>
            </div>
          )}
        </div>

        {/* Examples */}
        {(word.examples?.length > 0 || user?.is_admin) && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500">ประโยคตัวอย่าง</h3>
              {user?.is_admin && (
                <button
                  onClick={generateExamples}
                  disabled={genExLoading}
                  className="text-xs text-chinese-red disabled:opacity-50"
                >
                  {genExLoading ? '⏳ กำลังสร้าง...' : word.examples?.length > 0 ? '🔄 สุ่มใหม่' : '✨ สร้างตัวอย่าง'}
                </button>
              )}
            </div>
            {word.examples?.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">
                {user?.is_admin ? 'ยังไม่มีตัวอย่าง — กด ✨ สร้างตัวอย่าง' : 'ยังไม่มีตัวอย่าง'}
              </p>
            ) : (() => {
              // จัดกลุ่มตาม meaning_line
              const meaningLines = word.thai_meaning.split('\n').filter((l) => l.trim())
              const byLine = {}
              for (const ex of word.examples) {
                const line = ex.meaning_line ?? 0
                if (!byLine[line]) byLine[line] = []
                byLine[line].push(ex)
              }
              return (
                <div className="space-y-5">
                  {meaningLines.map((meaning, lineIdx) => {
                    const exs = (byLine[lineIdx] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                    if (!exs.length) return null
                    return (
                      <div key={lineIdx}>
                        {meaningLines.length > 1 && (
                          <div className="text-xs font-medium text-chinese-red mb-2">
                            ความหมาย: {meaning}
                          </div>
                        )}
                        <div className="space-y-3">
                          {exs.map((ex) => (
                            <div key={ex.id} className="border-l-2 border-chinese-gold pl-3">
                              <div className="flex items-center gap-2 mb-1">
                                {user?.is_admin && (
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                                    {getExampleLabel(ex.type)}
                                  </span>
                                )}
                                <button onClick={() => speak(ex.chinese)} className="text-gray-400 text-sm">
                                  🔊
                                </button>
                              </div>
                              <div className="font-chinese text-lg text-gray-800">{ex.chinese}</div>
                              {ex.pinyin && <div className="text-sm text-gray-500">{ex.pinyin}</div>}
                              {ex.thai && <div className="text-sm text-gray-700">{ex.thai}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* Admin Edit */}
        {user?.is_admin && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-orange-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-orange-600">แก้ไข (Admin)</h3>
              {!editData && (
                <button onClick={startEdit} className="text-xs text-chinese-red">
                  แก้ไข
                </button>
              )}
            </div>
            {editData ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">พินอิน</div>
                  <input
                    value={editData.pinyin}
                    onChange={(e) => setEditData({ ...editData, pinyin: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">ความหมายไทย</div>
                  <textarea
                    value={editData.thai_meaning}
                    onChange={(e) => setEditData({ ...editData, thai_meaning: e.target.value })}
                    rows={4}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red resize-none"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">English</div>
                  <input
                    value={editData.english_meaning}
                    onChange={(e) => setEditData({ ...editData, english_meaning: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">หมวดหมู่</div>
                  <input
                    value={editData.category}
                    onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60"
                  >
                    {editSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                  <button
                    onClick={() => setEditData(null)}
                    className="px-4 border border-gray-200 rounded-lg text-sm"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">กดแก้ไขเพื่อแก้ไขคำศัพท์นี้</p>
            )}
          </div>
        )}

        {/* Notes */}
        {user && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500">โน้ตส่วนตัว</h3>
              {note && !editingNote && (
                <button
                  onClick={() => setEditingNote(true)}
                  className="text-xs text-chinese-red"
                >
                  แก้ไข
                </button>
              )}
            </div>
            {editingNote || !note ? (
              <div>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="เขียนโน้ตของคุณที่นี่..."
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveNote}
                    className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium"
                  >
                    บันทึก
                  </button>
                  {editingNote && (
                    <button
                      onClick={() => { setNoteText(note?.note_text || ''); setEditingNote(false) }}
                      className="px-4 border border-gray-200 rounded-lg text-sm"
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-700 text-sm whitespace-pre-wrap">{note.note_text}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
