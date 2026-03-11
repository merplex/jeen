import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getHistory, deleteHistory, getFavorites, toggleFavorite } from '../services/api'
import useAuthStore from '../stores/authStore'
import { thaiDateTime } from '../utils/time'
import TonedChinese from '../components/TonedChinese'

export default function History() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState('history') // 'history' | 'favorites'
  const [history, setHistory] = useState([])
  const [favorites, setFavorites] = useState([])

  useEffect(() => {
    if (!user) return
    getHistory().then((r) => setHistory(r.data))
    getFavorites().then((r) => setFavorites(r.data))
  }, [user])

  const remove = async (id) => {
    await deleteHistory(id)
    setHistory((h) => h.filter((r) => r.id !== id))
  }

  const unfavorite = async (wordId) => {
    await toggleFavorite(wordId)
    setFavorites((f) => f.filter((r) => r.word_id !== wordId))
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
      <div className="bg-chinese-red px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-white text-xl font-bold">
            {tab === 'history' ? 'ประวัติค้นหา' : 'คำโปรด'}
          </h1>
          <span className="text-white/70 text-sm">
            {tab === 'history' ? `${history.length} / 100 รายการ` : `${favorites.length} คำ`}
          </span>
        </div>
        {/* Tab toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab('history')}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-all ${
              tab === 'history'
                ? 'bg-white text-chinese-red'
                : 'bg-white/20 text-white'
            }`}
          >
            ประวัติ
          </button>
          <button
            onClick={() => setTab('favorites')}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-all ${
              tab === 'favorites'
                ? 'bg-white text-chinese-red'
                : 'bg-white/20 text-white'
            }`}
          >
            ⭐ คำโปรด
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {tab === 'history' ? (
          history.length === 0 ? (
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
                    <TonedChinese chinese={h.query} pinyin={h.result_word_pinyin} className="font-medium text-gray-800 font-chinese" />
                    <div className="text-xs text-gray-400">
                      {thaiDateTime(h.searched_at)}
                      {!h.found && <span className="ml-2 text-red-400">ไม่พบ</span>}
                    </div>
                  </button>
                  <button onClick={() => remove(h.id)} className="text-gray-300 hover:text-red-400 text-xl">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          favorites.length === 0 ? (
            <div className="text-center text-gray-400 py-16">ยังไม่มีคำโปรด<br /><span className="text-sm">กด ☆ ในหน้าคำศัพท์เพื่อเพิ่ม</span></div>
          ) : (
            <div className="space-y-2">
              {favorites.map((f) => (
                <div
                  key={f.favorite_id}
                  className="bg-white rounded-xl flex items-center gap-3 px-4 py-3 shadow-sm"
                >
                  <button
                    className="flex-1 text-left"
                    onClick={() => navigate(`/word/${f.word_id}`)}
                  >
                    <TonedChinese chinese={f.chinese} pinyin={f.pinyin} className="font-medium text-gray-800 font-chinese" />
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                      {f.thai_meaning.split('\n')[0]}
                    </div>
                    <div className="text-xs text-gray-400">{thaiDateTime(f.favorited_at)}</div>
                  </button>
                  <button
                    onClick={() => unfavorite(f.word_id)}
                    className="text-yellow-400 text-xl"
                    title="ลบออกจากคำโปรด"
                  >
                    ⭐
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
