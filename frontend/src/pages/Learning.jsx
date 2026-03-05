import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFlashcards, getFlashcardStats, removeFlashcard, getSpeakingHistory, getSpeakingDailyStatus } from '../services/api'
import useAuthStore from '../stores/authStore'

const DECK_COLORS = {
  1: { bg: 'bg-chinese-red', border: 'border-chinese-red', text: 'text-chinese-red', light: 'bg-red-50' },
  2: { bg: 'bg-blue-500', border: 'border-blue-500', text: 'text-blue-500', light: 'bg-blue-50' },
  3: { bg: 'bg-green-500', border: 'border-green-500', text: 'text-green-500', light: 'bg-green-50' },
}

export default function Learning() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState('flashcard') // 'flashcard' | 'speaking'

  // Flashcard state
  const [selectedDeck, setSelectedDeck] = useState(1)
  const [stats, setStats] = useState({ '1': 0, '2': 0, '3': 0 })
  const [cards, setCards] = useState([])
  const [cardsLoading, setCardsLoading] = useState(false)

  // Speaking state
  const [speakingHistory, setSpeakingHistory] = useState([])
  const [dailyStatus, setDailyStatus] = useState(null)
  const [speakingLoading, setSpeakingLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    getFlashcardStats().then((r) => setStats(r.data)).catch(() => {})
  }, [user])

  useEffect(() => {
    if (!user || tab !== 'flashcard') return
    loadDeck(selectedDeck)
  }, [user, tab, selectedDeck])

  useEffect(() => {
    if (!user || tab !== 'speaking') return
    setSpeakingLoading(true)
    Promise.all([getSpeakingHistory(), getSpeakingDailyStatus()])
      .then(([h, s]) => { setSpeakingHistory(h.data); setDailyStatus(s.data) })
      .catch(() => {})
      .finally(() => setSpeakingLoading(false))
  }, [user, tab])

  const loadDeck = async (deck) => {
    setCardsLoading(true)
    try {
      const r = await getFlashcards(deck)
      setCards(r.data)
    } catch {
      setCards([])
    }
    setCardsLoading(false)
  }

  const handleRemove = async (wordId) => {
    await removeFlashcard(wordId, selectedDeck)
    const updated = cards.filter((c) => c.word_id !== wordId)
    setCards(updated)
    setStats((prev) => ({ ...prev, [String(selectedDeck)]: Math.max(0, prev[String(selectedDeck)] - 1) }))
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

  const isPremium = user?.is_admin === true // admin = no limit; TODO: เพิ่ม subscription check

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-4">
        <h1 className="text-white text-xl font-bold">เรียน</h1>
      </div>

      {/* Tab */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setTab('flashcard')}
          className={`flex-1 py-3 text-sm font-medium ${tab === 'flashcard' ? 'text-chinese-red border-b-2 border-chinese-red' : 'text-gray-500'}`}
        >
          📇 Flashcard
        </button>
        <button
          onClick={() => setTab('speaking')}
          className={`flex-1 py-3 text-sm font-medium ${tab === 'speaking' ? 'text-chinese-red border-b-2 border-chinese-red' : 'text-gray-500'}`}
        >
          🎙 Speaking
        </button>
      </div>

      {/* ===== FLASHCARD TAB ===== */}
      {tab === 'flashcard' && (
        <div className="px-4 pt-4 space-y-4">
          {/* Deck selector */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((deck) => {
              const c = DECK_COLORS[deck]
              const count = stats[String(deck)] || 0
              const locked = deck > 1 && !isPremium
              const active = selectedDeck === deck
              return (
                <button
                  key={deck}
                  onClick={() => !locked && setSelectedDeck(deck)}
                  className={`relative rounded-xl p-3 border-2 transition-all ${
                    active ? `${c.bg} border-transparent text-white` : `bg-white ${c.border} ${c.text}`
                  } ${locked ? 'opacity-50' : 'active:scale-95'}`}
                >
                  {locked && (
                    <span className="absolute top-1.5 right-1.5 text-[10px]">🔒</span>
                  )}
                  <div className={`text-xs font-medium mb-1 ${active ? 'text-white/80' : 'text-gray-400'}`}>
                    ชุดที่ {deck}
                  </div>
                  <div className={`text-2xl font-bold ${active ? 'text-white' : c.text}`}>{count}</div>
                  <div className={`text-xs ${active ? 'text-white/70' : 'text-gray-400'}`}>คำ</div>
                  {deck > 1 && !isPremium && (
                    <div className="text-[9px] text-gray-400 mt-1">Premium</div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Word list */}
          {selectedDeck > 1 && !isPremium ? (
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-3xl mb-2">🔒</div>
              <p className="text-gray-600 font-medium">ชุดที่ {selectedDeck} สำหรับสมาชิก</p>
              <p className="text-xs text-gray-400 mt-1">อัปเกรดเพื่อใช้การ์ดหลายชุด</p>
            </div>
          ) : cardsLoading ? (
            <div className="text-center text-gray-400 py-8 text-sm">กำลังโหลด...</div>
          ) : cards.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-4xl mb-2">📇</div>
              <p className="text-gray-500 text-sm">ยังไม่มีการ์ดในชุดที่ {selectedDeck}</p>
              <p className="text-xs text-gray-400 mt-1">กดสี่เหลี่ยม {selectedDeck} ในหน้าคำศัพท์เพื่อเพิ่ม</p>
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-400">{cards.length} คำในชุดนี้</span>
                <button
                  onClick={() => navigate(`/learning/play/${selectedDeck}`)}
                  className={`${DECK_COLORS[selectedDeck].bg} text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-95`}
                >
                  เริ่มเรียน →
                </button>
              </div>

              {/* List */}
              <div className="space-y-2">
                {cards.map((card) => (
                  <div key={card.id} className="bg-white rounded-xl px-4 py-3 shadow-sm flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-chinese text-xl text-chinese-red">{card.word.chinese}</span>
                        <span className="text-xs text-gray-400">{card.word.pinyin}</span>
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {card.word.thai_meaning.split('\n')[0]}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(card.word_id)}
                      className="text-gray-300 text-lg hover:text-red-400 transition-colors px-1"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== SPEAKING TAB ===== */}
      {tab === 'speaking' && (
        <div className="px-4 pt-4 space-y-4">
          {/* Daily status */}
          {dailyStatus && !dailyStatus.is_premium && (
            <div className={`rounded-xl p-3 flex items-center gap-3 ${dailyStatus.can_practice ? 'bg-green-50 border border-green-100' : 'bg-orange-50 border border-orange-100'}`}>
              <span className="text-xl">{dailyStatus.can_practice ? '✅' : '⏳'}</span>
              <div>
                <p className="text-sm font-medium text-gray-700">
                  {dailyStatus.can_practice
                    ? `ใช้ได้อีก ${dailyStatus.daily_limit - dailyStatus.today_count} ครั้งวันนี้`
                    : 'ใช้ครบโควต้าวันนี้แล้ว'}
                </p>
                <p className="text-xs text-gray-400">ฟรี {dailyStatus.daily_limit} ครั้ง/วัน</p>
              </div>
            </div>
          )}

          {/* History */}
          {speakingLoading ? (
            <div className="text-center text-gray-400 py-8 text-sm">กำลังโหลด...</div>
          ) : speakingHistory.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <div className="text-4xl mb-2">🎙</div>
              <p className="text-gray-500 text-sm">ยังไม่มีประวัติการฝึกพูด</p>
              <p className="text-xs text-gray-400 mt-1">กดปุ่ม 🎙 ในหน้าคำศัพท์เพื่อฝึก</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 px-1">ประวัติการฝึกพูด ({speakingHistory.length} ประโยค)</p>
              {speakingHistory.map((r) => {
                const total = r.pronunciation_score + r.tone_score + r.fluency_score
                const avg = Math.round(total / 3)
                const avgColor = avg >= 70 ? 'text-green-600' : avg >= 50 ? 'text-yellow-500' : 'text-red-500'
                return (
                  <div key={r.id} className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-chinese text-lg text-gray-800">{r.example_chinese}</div>
                        {r.word && (
                          <div className="text-xs text-gray-400">{r.word.chinese} · {r.word.pinyin}</div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-bold ${avgColor}`}>{avg}</div>
                        <div className="text-[10px] text-gray-400">{r.practice_count}x</div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <ScoreBar label="ออกเสียง" value={r.pronunciation_score} color="bg-blue-400" />
                      <ScoreBar label="โทน" value={r.tone_score} color="bg-purple-400" />
                      <ScoreBar label="คล่อง" value={r.fluency_score} color="bg-green-400" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreBar({ label, value, color }) {
  const pct = Math.round(value)
  return (
    <div className="flex-1">
      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
        <span>{label}</span>
        <span>{pct}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
