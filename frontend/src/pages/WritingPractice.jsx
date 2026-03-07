import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import HanziWriter from 'hanzi-writer'
import { getFlashcards } from '../services/api'
import useAuthStore from '../stores/authStore'

const DECK_COLORS = {
  1: { bg: 'bg-chinese-red', hex: '#cc2929', border: 'border-chinese-red', text: 'text-chinese-red' },
  2: { bg: 'bg-blue-500', hex: '#3b82f6', border: 'border-blue-500', text: 'text-blue-500' },
  3: { bg: 'bg-green-500', hex: '#22c55e', border: 'border-green-500', text: 'text-green-500' },
}

export default function WritingPractice() {
  const { deck } = useParams()
  const deckNum = Number(deck) || 1
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [cards, setCards] = useState([])
  const [cardIndex, setCardIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState('quiz') // 'quiz' | 'hint_done' | 'result' | 'finished'
  const [scoreInfo, setScoreInfo] = useState(null)
  const [hintLevel, setHintLevel] = useState(0)
  const [hintShowing, setHintShowing] = useState(false)
  const [hintOverlay, setHintOverlay] = useState(false) // CSS overlay — does NOT touch quiz state
  const [charError, setCharError] = useState(false)
  const [showHintBadge, setShowHintBadge] = useState(false)

  const svgRef = useRef(null)
  const hintSvgRef = useRef(null)   // second HanziWriter for hint overlay (always in DOM)
  const writerRef = useRef(null)
  const writerIdRef = useRef(0)
  const totalStrokesRef = useRef(0)
  const phaseRef = useRef('quiz')

  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    if (!user) return
    getFlashcards(deckNum)
      .then((r) => setCards([...r.data].sort(() => Math.random() - 0.5)))
      .finally(() => setLoading(false))
  }, [user, deckNum])

  const card = cards[cardIndex]
  const word = card?.word
  const chars = word ? [...word.chinese] : []
  const currentChar = chars[charIndex] || ''
  const color = DECK_COLORS[deckNum] || DECK_COLORS[1]

  // Initialize hanzi-writer when character changes
  useEffect(() => {
    if (!currentChar || !svgRef.current) return

    if (writerRef.current) {
      try { writerRef.current.cancelQuiz() } catch (e) {}
    }
    svgRef.current.innerHTML = ''
    if (hintSvgRef.current) hintSvgRef.current.innerHTML = ''

    setPhase('quiz')
    setScoreInfo(null)
    setHintLevel(0)
    setHintShowing(false)
    setHintOverlay(false)
    setCharError(false)
    setShowHintBadge(false)
    totalStrokesRef.current = 0
    phaseRef.current = 'quiz'

    writerIdRef.current += 1
    const myId = writerIdRef.current

    const writer = HanziWriter.create(svgRef.current, currentChar, {
      width: 260,
      height: 260,
      padding: 10,
      showOutline: false,
      showCharacter: false,
      strokeColor: color.hex,
      outlineColor: '#e5e7eb',
      drawingColor: '#1f2937',
      drawingWidth: 4,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 250,
      highlightColor: '#f59e0b',
      onLoadCharDataSuccess: (charData) => {
        if (writerIdRef.current !== myId) return
        totalStrokesRef.current = charData.strokes.length
      },
      onLoadCharDataError: () => {
        if (writerIdRef.current !== myId) return
        setCharError(true)
      },
    })

    writerRef.current = writer

    // Hint writer — same character, showCharacter=true, no quiz
    // Always rendered but invisible (opacity 0) until hint is pressed
    if (hintSvgRef.current) {
      HanziWriter.create(hintSvgRef.current, currentChar, {
        width: 260,
        height: 260,
        padding: 10,
        showOutline: false,
        showCharacter: true,
        strokeColor: color.hex,
        drawingWidth: 4,
      })
    }

    writer.quiz({
      onComplete: (data) => {
        if (writerIdRef.current !== myId) return
        const total = totalStrokesRef.current || 1
        const score = Math.max(0, Math.round(100 - (data.totalMistakes / total) * 100))
        setScoreInfo({ score, totalMistakes: data.totalMistakes, total })
        setPhase('result')
        phaseRef.current = 'result'
        if (score >= 90) {
          setTimeout(() => {
            if (writerIdRef.current === myId) writer.animateCharacter()
          }, 400)
        }
      },
    })
  }, [currentChar])

  // Hint system:
  //   Press 1 → show character 2 seconds then hide (quiz continues)
  //   Press 2 → show character 5 seconds then hide (quiz continues)
  //   Press 3 → show character permanently, cancel quiz, show "ถัดไป" button
  const handleHint = () => {
    if (phaseRef.current !== 'quiz' || !writerRef.current || hintShowing) return

    const newLevel = hintLevel + 1
    setHintLevel(newLevel)
    setShowHintBadge(true)

    const w = writerRef.current
    const myId = writerIdRef.current

    if (newLevel >= 3) {
      // Show overlay permanently, cancel quiz, wait for user to skip
      setHintOverlay(true)
      try { w.cancelQuiz() } catch (e) {}
      setPhase('hint_done')
      phaseRef.current = 'hint_done'
    } else {
      // Show CSS overlay for N seconds — quiz state is completely untouched
      const duration = newLevel === 1 ? 2000 : 5000
      setHintOverlay(true)
      setHintShowing(true)
      setTimeout(() => {
        if (writerIdRef.current !== myId) return
        setHintOverlay(false)
        setHintShowing(false)
      }, duration)
    }
  }

  const handleShowAnimation = () => {
    if (writerRef.current) writerRef.current.animateCharacter()
  }

  const goNext = () => {
    if (charIndex < chars.length - 1) {
      setCharIndex((i) => i + 1)
    } else if (cardIndex < cards.length - 1) {
      setCardIndex((i) => i + 1)
      setCharIndex(0)
    } else {
      setPhase('finished')
    }
  }

  const handleNext = () => {
    if (writerRef.current) {
      try { writerRef.current.cancelQuiz() } catch (e) {}
    }
    goNext()
  }

  if (!user) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <p className="text-gray-400">กรุณาเข้าสู่ระบบ</p>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <p className="text-gray-400">กำลังโหลด...</p>
    </div>
  )

  const headerColor = DECK_COLORS[deckNum] || DECK_COLORS[1]

  if (phase === 'finished') return (
    <div className="min-h-screen bg-chinese-cream">
      <div className={`${headerColor.bg} px-4 pt-12 pb-4 flex items-center gap-3`}>
        <button onClick={() => navigate('/learning')} className="text-white text-2xl">←</button>
        <h1 className="text-white text-lg font-bold">ฝึกเขียน ชุด {deckNum}</h1>
      </div>
      <div className="flex flex-col items-center justify-center py-20 px-4 gap-4">
        <div className="text-5xl">🎉</div>
        <p className="text-xl font-bold text-gray-800">ผ่านทุกคำแล้ว!</p>
        <p className="text-gray-400 text-sm">ฝึก {cards.length} คำ เสร็จสิ้น</p>
        <button
          onClick={() => navigate('/learning')}
          className={`mt-4 ${headerColor.bg} text-white px-8 py-3 rounded-xl font-semibold`}
        >
          กลับหน้าเรียน
        </button>
      </div>
    </div>
  )

  if (cards.length === 0) return (
    <div className="min-h-screen bg-chinese-cream">
      <div className={`${headerColor.bg} px-4 pt-12 pb-4 flex items-center gap-3`}>
        <button onClick={() => navigate('/learning')} className="text-white text-2xl">←</button>
        <h1 className="text-white text-lg font-bold">ฝึกเขียน ชุด {deckNum}</h1>
      </div>
      <div className="text-center text-gray-400 py-16 px-4">
        <div className="text-5xl mb-4">✏️</div>
        <p>ไม่มีการ์ดในชุดนี้</p>
        <button onClick={() => navigate('/learning')} className="mt-4 text-sm text-chinese-red">
          ← กลับ
        </button>
      </div>
    </div>
  )

  const scoreColor = scoreInfo
    ? scoreInfo.score >= 90 ? 'text-green-500' : scoreInfo.score >= 70 ? 'text-yellow-500' : 'text-red-500'
    : ''

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className={`${headerColor.bg} px-4 pt-12 pb-4 flex items-center gap-3`}>
        <button onClick={() => navigate('/learning')} className="text-white text-2xl">←</button>
        <div>
          <h1 className="text-white text-lg font-bold">ฝึกเขียน ชุด {deckNum}</h1>
          <p className="text-white/70 text-sm">{cards.length} คำ</p>
        </div>
      </div>

      {/* Progress */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-3">
        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
          <div
            className={`${headerColor.bg} h-1.5 rounded-full transition-all`}
            style={{ width: `${((cardIndex) / cards.length) * 100}%` }}
          />
        </div>
        <span className="text-gray-400 text-xs shrink-0">{cardIndex + 1} / {cards.length}</span>
      </div>

      <div className="px-4 py-4 flex flex-col items-center gap-4">
        {/* Word hint area */}
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm px-5 py-4">
          {chars.length > 1 && (
            <div className="flex gap-2 items-center mb-3">
              {chars.map((ch, i) => (
                <span
                  key={i}
                  className={`font-chinese text-2xl transition-all ${
                    i === charIndex
                      ? `${color.text} font-bold`
                      : i < charIndex
                      ? 'text-gray-300'
                      : 'text-gray-300'
                  }`}
                >
                  {i < charIndex ? ch : '?'}
                </span>
              ))}
              <span className="text-xs text-gray-400 ml-1">ตัวที่ {charIndex + 1}/{chars.length}</span>
            </div>
          )}

          <div className="text-blue-400 text-sm font-mono mb-1">{word?.pinyin}</div>
          <div className="text-gray-600 text-sm leading-relaxed">
            {word?.thai_meaning?.split('\n').filter(Boolean).slice(0, 2).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>

        {/* Quiz controls */}
        {phase === 'quiz' && !charError && (
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={handleHint}
              disabled={hintShowing}
              className="flex-1 bg-amber-50 border border-amber-200 text-amber-600 rounded-xl py-3 text-sm font-medium active:scale-95 disabled:opacity-50"
            >
              {hintShowing
                ? `👁 กำลังแสดง...`
                : `💡 คำใบ้${hintLevel > 0 ? ` (${hintLevel})` : ''}`}
            </button>
            <button
              onClick={handleNext}
              className="flex-1 bg-gray-100 text-gray-600 rounded-xl py-3 text-sm font-medium active:scale-95"
            >
              ข้าม →
            </button>
          </div>
        )}

        {/* Hint done: character shown permanently, wait for next */}
        {phase === 'hint_done' && !charError && (
          <div className="w-full max-w-sm">
            <p className="text-center text-xs text-amber-500 mb-3">จำรูปอักษรไว้นะ แล้วเขียนเองได้เลย</p>
            <button
              onClick={goNext}
              className={`w-full ${headerColor.bg} text-white rounded-xl py-3 text-sm font-semibold active:scale-95`}
            >
              ถัดไป →
            </button>
          </div>
        )}

        {/* Hanzi writer area */}
        <div className="relative">
          <div className="bg-white rounded-2xl shadow-md p-3">
            {charError ? (
              <div className="w-[260px] h-[260px] flex flex-col items-center justify-center gap-2">
                <div className="text-4xl">{currentChar}</div>
                <p className="text-xs text-gray-400">ไม่มีข้อมูลการเขียน</p>
              </div>
            ) : (
              <div ref={svgRef} style={{ width: 260, height: 260 }} />
            )}
          </div>

          {/* Hint overlay — second HanziWriter, always in DOM, opacity controlled */}
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none p-3"
            style={{ opacity: hintOverlay ? 0.25 : 0 }}
          >
            <div ref={hintSvgRef} style={{ width: 260, height: 260 }} />
          </div>

          {/* Score overlay on result */}
          {phase === 'result' && scoreInfo && (
            <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
              <div className="bg-black/60 rounded-xl px-4 py-2 text-center">
                <div className={`text-3xl font-bold ${scoreColor}`}>{scoreInfo.score}%</div>
                <div className="text-white/70 text-xs">
                  {scoreInfo.totalMistakes === 0 ? 'สมบูรณ์!' : `ผิด ${scoreInfo.totalMistakes} ครั้ง`}
                  {showHintBadge && <span className="ml-1">(ใช้คำใบ้)</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* charError skip */}
        {charError && (
          <button
            onClick={goNext}
            className={`w-full max-w-sm ${headerColor.bg} text-white rounded-xl py-3 text-sm font-semibold active:scale-95`}
          >
            ถัดไป →
          </button>
        )}

        {/* Result controls */}
        {phase === 'result' && scoreInfo && (
          <div className="flex flex-col gap-3 w-full max-w-sm">
            <div className={`text-center text-sm font-medium ${scoreColor}`}>
              {scoreInfo.score >= 90
                ? '🎉 เยี่ยม! แสดงลำดับขีดให้ดูแล้ว'
                : scoreInfo.score >= 70
                ? 'ดี! ลองดูลำดับขีดที่ถูกต้อง'
                : 'ฝึกต่อไปนะ! ดูลำดับขีดที่ถูกต้องได้เลย'}
            </div>

            {scoreInfo.score < 90 && (
              <button
                onClick={handleShowAnimation}
                className="w-full border-2 border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-medium active:scale-95"
              >
                ▶ ดูลำดับขีด
              </button>
            )}

            <button
              onClick={goNext}
              className={`w-full ${headerColor.bg} text-white rounded-xl py-3 text-sm font-semibold active:scale-95`}
            >
              ถัดไป →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
