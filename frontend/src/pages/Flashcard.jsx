import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFlashcards, removeFlashcard } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function Flashcard() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [cards, setCards] = useState([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!user) return
    getFlashcards().then((r) => setCards(r.data))
  }, [user])

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

  const card = cards[index]
  const word = card?.word

  const prev = () => { setIndex((i) => Math.max(0, i - 1)); setFlipped(false) }
  const next = () => { setIndex((i) => Math.min(cards.length - 1, i + 1)); setFlipped(false) }

  const removeCurrent = async () => {
    await removeFlashcard(word.id)
    const updated = cards.filter((_, i) => i !== index)
    setCards(updated)
    setIndex(Math.min(index, updated.length - 1))
    setFlipped(false)
  }

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="text-white text-xl font-bold">แฟลชการ์ด</h1>
        <p className="text-white/70 text-sm">{cards.length} คำ</p>
      </div>

      {cards.length === 0 ? (
        <div className="text-center text-gray-400 py-16 px-4">
          <div className="text-5xl mb-4">📇</div>
          <p>ยังไม่มีแฟลชการ์ด</p>
          <p className="text-sm mt-1">กดดาว ⭐ ในหน้าคำศัพท์เพื่อเพิ่ม</p>
        </div>
      ) : (
        <div className="px-4 py-8 flex flex-col items-center gap-6">
          {/* Progress */}
          <p className="text-gray-400 text-sm">{index + 1} / {cards.length}</p>

          {/* Card */}
          <button
            onClick={() => setFlipped((f) => !f)}
            className="w-full max-w-sm h-56 bg-white rounded-2xl shadow-lg flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-95 transition-transform"
          >
            {!flipped ? (
              <>
                <div className="font-chinese text-5xl text-chinese-red">{word?.chinese}</div>
                <div className="text-gray-400 text-sm">{word?.pinyin}</div>
                <div className="text-xs text-gray-300 mt-4">แตะเพื่อดูความหมาย</div>
              </>
            ) : (
              <>
                <div className="text-xl text-gray-800 text-center px-6">{word?.thai_meaning}</div>
                {word?.english_meaning && (
                  <div className="text-sm text-gray-400">{word.english_meaning}</div>
                )}
              </>
            )}
          </button>

          {/* Controls */}
          <div className="flex gap-4 w-full max-w-sm">
            <button
              onClick={prev}
              disabled={index === 0}
              className="flex-1 bg-white border border-gray-200 rounded-xl py-3 text-gray-600 disabled:opacity-40"
            >
              ← ก่อนหน้า
            </button>
            <button
              onClick={next}
              disabled={index === cards.length - 1}
              className="flex-1 bg-chinese-red text-white rounded-xl py-3"
            >
              ถัดไป →
            </button>
          </div>

          <div className="flex gap-4">
            <button onClick={() => navigate(`/word/${word?.id}`)} className="text-sm text-chinese-red">
              ดูรายละเอียด
            </button>
            <button onClick={removeCurrent} className="text-sm text-gray-400">
              ลบออกจากการ์ด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
