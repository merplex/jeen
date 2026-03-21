import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteHistory, toggleFavorite, addFlashcard } from '../services/api'
import { toggleFavoriteOffline } from '../services/favoritesSyncService'
import useAuthStore from '../stores/authStore'
import useSubscriptionStore from '../stores/subscriptionStore'
import { thaiDateTime } from '../utils/time'
import TonedChinese from '../components/TonedChinese'
import { getLocalHistory, deleteLocalHistory } from '../services/offlineDb'
import db from '../services/offlineDb'

async function loadLocalFavorites() {
  const localFavs = await db.favorites.filter(f => !f._deleted).toArray()
  if (localFavs.length === 0) return []
  const wordIds = localFavs.map(f => f.word_id)
  const words = await db.words.where('id').anyOf(wordIds).toArray()
  const wordMap = Object.fromEntries(words.map(w => [w.id, w]))
  return localFavs
    .filter(f => wordMap[f.word_id])
    .map(f => ({
      favorite_id: f.word_id,
      word_id: f.word_id,
      chinese: wordMap[f.word_id].chinese,
      pinyin: wordMap[f.word_id].pinyin,
      thai_meaning: wordMap[f.word_id].thai_meaning,
      favorited_at: f.created_at,
    }))
}

const DECK_COLORS = {
  1: 'border-chinese-red text-chinese-red',
  2: 'border-blue-500 text-blue-500',
  3: 'border-green-500 text-green-500',
}

export default function History() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { subscription } = useSubscriptionStore()
  const isPremium = user?.is_admin || subscription?.active === true
  const [tab, setTab] = useState('history') // 'history' | 'favorites'
  const [history, setHistory] = useState([])
  const [favorites, setFavorites] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [addingDeck, setAddingDeck] = useState(null)

  // อ่านจาก local เสมอ — ข้อมูลขึ้นทันที ไม่ต้องรอ server
  useEffect(() => {
    if (!user) return
    getLocalHistory().then(setHistory)
    loadLocalFavorites().then(setFavorites)
  }, [user])

  const remove = async (id) => {
    await deleteLocalHistory(id).catch(() => {})
    deleteHistory(id).catch(() => {}) // fire-and-forget ขึ้น server
    setHistory((h) => h.filter((r) => r.id !== id))
  }

  const unfavorite = async (wordId) => {
    await toggleFavoriteOffline(wordId) // local ก่อน
    toggleFavorite(wordId).catch(() => {}) // fire-and-forget server
    setFavorites((f) => f.filter((r) => r.word_id !== wordId))
    setSelectedIds((s) => { const n = new Set(s); n.delete(wordId); return n })
  }

  const toggleSelect = (wordId) => {
    setSelectedIds((s) => {
      const n = new Set(s)
      if (n.has(wordId)) n.delete(wordId)
      else n.add(wordId)
      return n
    })
  }

  const addToFlashcard = async (deck) => {
    if (selectedIds.size === 0) return
    setAddingDeck(deck)
    try {
      await Promise.all([...selectedIds].map((wid) => addFlashcard(wid, deck)))
      setSelectedIds(new Set())
    } catch (e) {
      alert(e.response?.data?.detail || 'เพิ่มไม่สำเร็จ')
    }
    setAddingDeck(null)
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
        {/* +Flashcard buttons (favorites tab only) */}
        {tab === 'favorites' && favorites.length > 0 && (
          <div className="flex gap-2 mt-3">
            {[1, 2, 3].map((deck) => {
              const locked = deck > 1 && !isPremium
              return (
                <button
                  key={deck}
                  disabled={selectedIds.size === 0 || locked || addingDeck !== null}
                  onClick={() => addToFlashcard(deck)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded border transition-all
                    ${DECK_COLORS[deck]} bg-white
                    disabled:opacity-40 active:scale-95`}
                >
                  {addingDeck === deck ? '...' : locked ? '🔒 ' : <><span className="font-black">+</span></>}Flash card {deck}
                </button>
              )
            })}
          </div>
        )}
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
              {favorites.map((f) => {
                const checked = selectedIds.has(f.word_id)
                return (
                  <div
                    key={f.favorite_id}
                    className={`bg-white rounded-xl flex items-center gap-3 px-3 py-3 shadow-sm transition-colors ${checked ? 'ring-2 ring-chinese-red' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(f.word_id)}
                      className="w-4 h-4 accent-chinese-red flex-shrink-0 cursor-pointer"
                    />
                    <button
                      className="flex-1 text-left min-w-0"
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
                      className="text-yellow-400 text-xl flex-shrink-0"
                      title="ลบออกจากคำโปรด"
                    >
                      ⭐
                    </button>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
