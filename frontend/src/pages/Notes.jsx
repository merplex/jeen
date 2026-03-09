import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotes, deleteNote } from '../services/api'
import useAuthStore from '../stores/authStore'
import { thaiDateTime } from '../utils/time'
import TonedChinese from '../components/TonedChinese'

export default function Notes() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [notes, setNotes] = useState([])
  const [search, setSearch] = useState('')

  const fetchNotes = (q = '') => getNotes(q).then((r) => setNotes(r.data))

  useEffect(() => {
    if (user) fetchNotes()
  }, [user])

  const handleSearch = (e) => {
    const v = e.target.value
    setSearch(v)
    fetchNotes(v)
  }

  const remove = async (id) => {
    await deleteNote(id)
    setNotes((n) => n.filter((x) => x.id !== id))
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
        {notes.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            <div className="text-5xl mb-4">📝</div>
            <p>ยังไม่มีโน้ต</p>
            <p className="text-sm mt-1">เพิ่มโน้ตได้จากหน้ารายละเอียดคำศัพท์</p>
          </div>
        ) : (
          notes.map((note) => (
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
          ))
        )}
      </div>
    </div>
  )
}
