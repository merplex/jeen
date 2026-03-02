import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHistory, deleteHistory } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function History() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!user) return
    getHistory().then((r) => setHistory(r.data))
  }, [user])

  const remove = async (id) => {
    await deleteHistory(id)
    setHistory((h) => h.filter((r) => r.id !== id))
  }

  if (!user) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center pb-24">
      <div className="text-center">
        <p className="text-gray-500">กรุณาเข้าสู่ระบบก่อน</p>
        <button
          onClick={() => navigate('/login')}
          className="mt-4 bg-chinese-red text-white px-6 py-2 rounded-xl"
        >
          เข้าสู่ระบบ
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="text-white text-xl font-bold">ประวัติค้นหา</h1>
        <p className="text-white/70 text-sm">{history.length} / 100 รายการ</p>
      </div>
      <div className="px-4 py-4">
        {history.length === 0 ? (
          <div className="text-center text-gray-400 py-16">ยังไม่มีประวัติการค้นหา</div>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="bg-white rounded-xl flex items-center gap-3 px-4 py-3 shadow-sm"
              >
                <button
                  className="flex-1 text-left"
                  onClick={() =>
                    h.result_word_id
                      ? navigate(`/word/${h.result_word_id}`)
                      : navigate(`/?q=${encodeURIComponent(h.query)}`)
                  }
                >
                  <div className="font-medium text-gray-800">{h.query}</div>
                  <div className="text-xs text-gray-400">
                    {new Date(h.searched_at).toLocaleString('th-TH')}
                    {!h.found && <span className="ml-2 text-red-400">ไม่พบ</span>}
                  </div>
                </button>
                <button onClick={() => remove(h.id)} className="text-gray-300 hover:text-red-400 text-xl">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
