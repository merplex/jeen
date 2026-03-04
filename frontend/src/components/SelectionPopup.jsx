import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchWords, reportMissedSearchDirect } from '../services/api'

const CHINESE_RE = /[\u4e00-\u9fff]/
const THAI_RE = /[\u0e00-\u0e7f]/
const isSearchable = (t) => CHINESE_RE.test(t) || THAI_RE.test(t)

export default function SelectionPopup() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  // Detect text selection — mouseup (desktop) + selectionchange (mobile handles)
  useEffect(() => {
    let timer = null
    let lastMouseUp = 0  // timestamp ของ mouseup ล่าสุด

    const tryOpen = () => {
      const text = window.getSelection()?.toString().trim()
      if (text && isSearchable(text) && text.length <= 20) {
        setQuery(text)
        setOpen(true)
      }
    }

    // Desktop: mouseup → check ทันที (10ms)
    const onMouseUp = () => {
      lastMouseUp = Date.now()
      clearTimeout(timer)
      timer = setTimeout(tryOpen, 10)
    }

    // Mobile: selectionchange (handle drag) → debounce 300ms
    // ถ้าเพิ่ง mouseup มาไม่ถึง 200ms = desktop selection → ข้ามไป ไม่ต้อง override
    const onSelectionChange = () => {
      if (Date.now() - lastMouseUp < 200) return
      clearTimeout(timer)
      timer = setTimeout(tryOpen, 300)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [])

  // Search when query changes
  useEffect(() => {
    if (!query) return
    setLoading(true)
    setResults([])
    const captured = query

    const extractResults = (r) =>
      [...(r.data?.prefix_group || []), ...(r.data?.inner_group || [])]

    searchWords(captured)
      .then((r) => {
        const all = extractResults(r)
        if (all.length > 0) {
          setResults(all.slice(0, 10))
          return
        }
        // ไม่เจอคำเต็ม: ถ้าเลือกหลายอักษร → fallback ค้นอักษรแรกตัวเดียว
        if (captured.length > 1) {
          return searchWords(captured[0])
            .then((r2) => {
              const fallback = extractResults(r2)
              setResults(fallback.slice(0, 10))
              // ถ้า fallback ก็ยังไม่มี → report missed
              if (fallback.length === 0) {
                reportMissedSearchDirect(captured).catch(() => {})
              }
            })
            .catch(() => {})
        }
        // อักษรเดียวไม่เจอ → report missed
        setResults([])
        reportMissedSearchDirect(captured).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    window.getSelection()?.removeAllRanges()
  }, [])

  const goToWord = (word) => {
    close()
    navigate(`/words/${word.id}`)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />

      {/* Bottom Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '55vh' }}>
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 flex items-center justify-between border-b border-gray-100 flex-shrink-0">
          <div className="text-sm text-gray-500">
            ค้นหา:{' '}
            <span className="font-chinese text-gray-900 text-base font-semibold">
              {query}
            </span>
          </div>
          <button onClick={close} className="text-gray-400 text-xl leading-none px-1">
            ✕
          </button>
        </div>

        {/* Results list */}
        <div className="overflow-y-auto flex-1">
          {loading && (
            <p className="text-xs text-gray-400 text-center py-8">กำลังค้นหา...</p>
          )}

          {!loading && results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">ไม่พบคำศัพท์สำหรับ "{query}"</p>
          )}

          {results.map((word) => (
            <button
              key={word.id}
              onClick={() => goToWord(word)}
              className="w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 active:bg-gray-50 transition-colors"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-chinese text-xl text-gray-900">{word.chinese}</span>
                <span className="text-xs text-gray-400">{word.pinyin}</span>
              </div>
              <div className="text-sm text-gray-600 mt-0.5">
                {word.thai_meaning.split('\n').filter(l => l.trim()).slice(0, 2).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
