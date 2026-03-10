import { useState, useRef, useEffect, useCallback } from 'react'
import { recognizeHandwriting } from '../services/api'
import OfflineAlert from './OfflineAlert'

export default function HandwritingModal({ onConfirm, onClose }) {
  const canvasRef = useRef(null)
  const [strokes, setStrokes] = useState([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [buffer, setBuffer] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [showOfflineAlert, setShowOfflineAlert] = useState(false)
  const recognizeTimerRef = useRef(null)
  const startTimeRef = useRef(0)
  const currentStrokeRef = useRef({ xs: [], ys: [], ts: [] })
  const ctxRef = useRef(null)

  // Init canvas size
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const touch = e.touches?.[0] || e
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const redrawAll = useCallback((allStrokes) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 3.5
    for (const stroke of allStrokes) {
      const xs = stroke[0], ys = stroke[1]
      if (xs.length < 1) continue
      ctx.beginPath()
      ctx.moveTo(xs[0], ys[0])
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i])
      ctx.stroke()
    }
  }, [])

  const doRecognize = useCallback(async (strokesData) => {
    if (!strokesData.length) return
    if (!navigator.onLine) { setShowOfflineAlert(true); return }
    const canvas = canvasRef.current
    setRecognizing(true)
    try {
      const r = await recognizeHandwriting({
        strokes: strokesData,
        width: canvas?.width || 280,
        height: canvas?.height || 280,
      })
      setCandidates(r.data.candidates || [])
    } catch {}
    setRecognizing(false)
  }, [])

  const handleDown = (e) => {
    e.preventDefault()
    const { x, y } = getPos(e)
    setIsDrawing(true)
    startTimeRef.current = Date.now()
    currentStrokeRef.current = { xs: [x], ys: [y], ts: [0] }
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(x, y)
    clearTimeout(recognizeTimerRef.current)
  }

  const handleMove = (e) => {
    e.preventDefault()
    if (!isDrawing) return
    const { x, y } = getPos(e)
    const t = Date.now() - startTimeRef.current
    currentStrokeRef.current.xs.push(x)
    currentStrokeRef.current.ys.push(y)
    currentStrokeRef.current.ts.push(t)
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const handleUp = (e) => {
    e.preventDefault()
    if (!isDrawing) return
    setIsDrawing(false)
    const { xs, ys, ts } = currentStrokeRef.current
    if (!xs.length) return
    const newStroke = [xs, ys, ts]
    setStrokes((prev) => {
      const updated = [...prev, newStroke]
      clearTimeout(recognizeTimerRef.current)
      recognizeTimerRef.current = setTimeout(() => doRecognize(updated), 700)
      return updated
    })
  }

  const selectCandidate = (char) => {
    setBuffer((prev) => prev + char)
    setStrokes([])
    setCandidates([])
    clearTimeout(recognizeTimerRef.current)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const undoStroke = () => {
    setStrokes((prev) => {
      const updated = prev.slice(0, -1)
      redrawAll(updated)
      if (!updated.length) {
        setCandidates([])
      } else {
        clearTimeout(recognizeTimerRef.current)
        recognizeTimerRef.current = setTimeout(() => doRecognize(updated), 300)
      }
      return updated
    })
  }

  const clearCanvas = () => {
    setStrokes([])
    setCandidates([])
    clearTimeout(recognizeTimerRef.current)
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end" onClick={onClose}>
      {showOfflineAlert && <OfflineAlert onClose={() => setShowOfflineAlert(false)} />}
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg mx-auto bg-white rounded-t-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <button onClick={onClose} className="text-sm text-gray-400 px-1 py-1">
            ยกเลิก
          </button>
          {/* Buffer display */}
          <div className="flex items-center gap-2 min-h-[36px]">
            {buffer ? (
              <span className="font-chinese text-2xl text-chinese-red tracking-wider">{buffer}</span>
            ) : (
              <span className="text-xs text-gray-300">เขียนตัวอักษรจีนในกล่องด้านล่าง</span>
            )}
            {recognizing && (
              <svg className="w-3.5 h-3.5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
          </div>
          <button
            onClick={() => { if (buffer) onConfirm(buffer); onClose() }}
            disabled={!buffer}
            className="text-sm font-semibold text-chinese-red disabled:text-gray-200 px-1 py-1"
          >
            ยืนยัน
          </button>
        </div>

        {/* Candidates */}
        <div className="flex gap-2 px-4 py-1.5 min-h-[48px] items-center overflow-x-auto scrollbar-hide">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => selectCandidate(c)}
              className={`font-chinese text-2xl px-3 py-1 rounded-xl border-2 shrink-0 transition-colors ${
                i === 0
                  ? 'border-chinese-red bg-chinese-red/5 text-chinese-red'
                  : 'border-gray-200 text-gray-700 active:bg-gray-50'
              }`}
            >
              {c}
            </button>
          ))}
          {!candidates.length && !recognizing && strokes.length > 0 && (
            <p className="text-xs text-gray-300">จำตัวอักษรไม่ได้ — ลองเขียนใหม่</p>
          )}
        </div>

        {/* Canvas */}
        <div className="px-4 pb-2">
          <canvas
            ref={canvasRef}
            className="w-full rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 touch-none"
            style={{ height: '220px' }}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleUp}
            onTouchStart={handleDown}
            onTouchMove={handleMove}
            onTouchEnd={handleUp}
          />
        </div>

        {/* Controls */}
        <div className="flex gap-2 px-4 pb-10 pt-1">
          <button
            onClick={undoStroke}
            disabled={!strokes.length}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 disabled:opacity-30 active:bg-gray-50"
          >
            ← ย้อน
          </button>
          <button
            onClick={clearCanvas}
            disabled={!strokes.length}
            className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 disabled:opacity-30 active:bg-gray-50"
          >
            ล้าง
          </button>
          <button
            onClick={() => setBuffer((prev) => prev.slice(0, -1))}
            disabled={!buffer}
            className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 disabled:opacity-30 active:bg-gray-50"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  )
}
