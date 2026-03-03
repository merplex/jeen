import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchWords } from '../services/api'

const CHINESE_RE = /[\u4e00-\u9fff]/

export default function SelectionPopup() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)

  // Detect text selection
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim()
      // Only care about Chinese chars, 1–8 chars
      if (text && CHINESE_RE.test(text) && text.length <= 8) {
        clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          setQuery(text)
          setOpen(true)
        }, 300)
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(debounceRef.current)
    }
  }, [])

  // Search when query changes
  useEffect(() => {
    if (!query) return
    setLoading(true)
    setResults([])
    searchWords(query)
      .then((r) => {
        const all = [...(r.data?.prefix_group || []), ...(r.data?.inner_group || [])]
        setResults(all.slice(0, 10))
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
              <div className="text-sm text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-line">
                {word.thai_meaning}
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
