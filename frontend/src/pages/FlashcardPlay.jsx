import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getFlashcards } from '../services/api'
import useAuthStore from '../stores/authStore'
import TonedChinese from '../components/TonedChinese'

const DECK_COLORS = {
  1: 'bg-chinese-red',
  2: 'bg-blue-500',
  3: 'bg-green-500',
}

export default function FlashcardPlay() {
  const { deck } = useParams()
  const deckNum = Number(deck) || 1
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    getFlashcards(deckNum)
      .then((r) => setCards([...r.data].sort(() => Math.random() - 0.5)))
      .finally(() => setLoading(false))
  }, [user, deckNum])

  const speak = (text) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  if (loading) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <p className="text-gray-400">กำลังโหลด...</p>
    </div>
  )

  const card = cards[index]
  const word = card?.word
  const headerColor = DECK_COLORS[deckNum] || DECK_COLORS[1]

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className={`${headerColor} px-4 pt-12 pb-4 flex items-center gap-3`}>
        <button onClick={() => navigate('/learning')} className="text-white text-2xl">←</button>
        <div>
          <h1 className="text-white text-lg font-bold">Flashcard ชุด {deckNum}</h1>
          <p className="text-white/70 text-sm">{cards.length} คำ</p>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="text-center text-gray-400 py-16 px-4">
          <div className="text-5xl mb-4">📇</div>
          <p>ไม่มีการ์ดในชุดนี้</p>
          <button onClick={() => navigate('/learning')} className="mt-4 text-sm text-chinese-red">
            ← กลับ
          </button>
        </div>
      ) : (
        <div className="px-4 py-8 flex flex-col items-center gap-6">
          {/* Progress */}
          <div className="flex items-center gap-3 w-full max-w-sm">
            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
              <div
                className={`${headerColor} h-1.5 rounded-full transition-all`}
                style={{ width: `${((index + 1) / cards.length) * 100}%` }}
              />
            </div>
            <span className="text-gray-400 text-xs shrink-0">{index + 1} / {cards.length}</span>
          </div>

          {/* Card */}
          <button
            onClick={() => setFlipped((f) => !f)}
            className="w-full max-w-sm h-60 bg-white rounded-2xl shadow-lg flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-95 transition-transform"
          >
            {!flipped ? (
              <>
                <TonedChinese chinese={word?.chinese} pinyin={word?.pinyin} className="font-chinese text-5xl" />
                <div className="text-gray-400 text-sm">{word?.pinyin}</div>
                <div className="text-xs text-gray-300 mt-4">แตะเพื่อดูความหมาย</div>
              </>
            ) : (
              <>
                <div className="text-xl text-gray-800 text-center px-6 leading-relaxed">
                  {word?.thai_meaning?.split('\n').filter(Boolean).slice(0, 2).join('\n')}
                </div>
                {word?.english_meaning && (
                  <div className="text-sm text-gray-400 text-center px-6">{word.english_meaning}</div>
                )}
              </>
            )}
          </button>

          {/* Controls */}
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={() => { setIndex((i) => Math.max(0, i - 1)); setFlipped(false) }}
              disabled={index === 0}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-3 text-gray-600 disabled:opacity-40 text-sm"
            >
              ← ก่อนหน้า
            </button>
            <button
              onClick={() => speak(word?.chinese)}
              className="px-4 bg-white border border-gray-200 rounded-xl text-lg"
            >
              🔊
            </button>
            <button
              onClick={() => { setIndex((i) => Math.min(cards.length - 1, i + 1)); setFlipped(false) }}
              disabled={index === cards.length - 1}
              className={`flex-1 ${headerColor} text-white rounded-xl py-3 disabled:opacity-40 text-sm`}
            >
              ถัดไป →
            </button>
          </div>

          <button
            onClick={() => navigate(`/word/${word?.id}`)}
            className="text-sm text-gray-400"
          >
            ดูรายละเอียด
          </button>
        </div>
      )}
    </div>
  )
}
