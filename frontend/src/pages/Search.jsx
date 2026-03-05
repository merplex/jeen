import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchWords, reportMissedSearch, recordSearchHistory, getRandomWords, scanOcr } from '../services/api'
import WordCard from '../components/WordCard'
import { SEARCH_CATEGORIES } from '../utils/categories'
import useAuthStore from '../stores/authStore'

function loadCatUsage() {
  try { return JSON.parse(localStorage.getItem('cat_usage') || '{}') } catch { return {} }
}

export default function Search() {
  const navigate = useNavigate()
  const { token, fetchingMe } = useAuthStore()

  const [query, setQuery] = useState(() => sessionStorage.getItem('search_query') || '')
  const [result, setResult] = useState(() => {
    const r = sessionStorage.getItem('search_result')
    return r ? JSON.parse(r) : null
  })
  const [loading, setLoading] = useState(false)
  const [randomWords, setRandomWords] = useState([])
  const [category, setCategory] = useState(() => sessionStorage.getItem('search_category') || 'ทั้งหมด')
  const [catUsage, setCatUsage] = useState(loadCatUsage)
  const [ocrResult, setOcrResult] = useState(null)  // { text, translation, words }
  const [ocrLoading, setOcrLoading] = useState(false)
  const ocrInputRef = useRef(null)

  const sortedCategories = [
    'ทั้งหมด',
    ...SEARCH_CATEGORIES.filter((c) => c !== 'ทั้งหมด')
      .sort((a, b) => (catUsage[b] || 0) - (catUsage[a] || 0)),
  ]

  const missedTimerRef = useRef(null)
  const historyTimerRef = useRef(null)
  const currentQueryRef = useRef('')
  const enterPressedRef = useRef(false)

  useEffect(() => () => {
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
  }, [])

  useEffect(() => { sessionStorage.setItem('search_query', query) }, [query])
  useEffect(() => {
    if (result) sessionStorage.setItem('search_result', JSON.stringify(result))
    else sessionStorage.removeItem('search_result')
  }, [result])
  useEffect(() => { sessionStorage.setItem('search_category', category) }, [category])

  // redirect ถ้าไม่มี token (หลัง hooks ทั้งหมด)
  useEffect(() => {
    if (!token && !fetchingMe) navigate('/login', { replace: true })
  }, [token, fetchingMe, navigate])

  // โหลดคำสุ่มตอนเปิดครั้งแรก
  useEffect(() => {
    if (!token || query) return
    getRandomWords(30).then((r) => setRandomWords(r.data)).catch(() => {})
  }, [token])

  const scheduleMissedReport = useCallback((q) => {
    clearTimeout(missedTimerRef.current)
    if (enterPressedRef.current) {
      enterPressedRef.current = false
      reportMissedSearch(q).catch(() => {})
    } else {
      missedTimerRef.current = setTimeout(() => {
        reportMissedSearch(q).catch(() => {})
      }, 10000)
    }
  }, [])

  const scheduleHistory = useCallback((q, wordId, found) => {
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      recordSearchHistory(q, wordId, found).catch(() => {})
    }, 3000)
  }, [])

  const recordHistoryNow = useCallback((q, wordId, found) => {
    clearTimeout(historyTimerRef.current)
    recordSearchHistory(q, wordId, found).catch(() => {})
  }, [])

  const doSearch = useCallback(async (q) => {
    currentQueryRef.current = q
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
    if (!q.trim()) { setResult(null); return }
    setLoading(true)
    try {
      const res = await searchWords(q.trim())
      if (q !== currentQueryRef.current) return
      setResult(res.data)
      const firstWordId = res.data.prefix_group?.[0]?.id ?? res.data.inner_group?.[0]?.id ?? null
      if (!res.data.found) {
        scheduleMissedReport(q.trim())
      } else {
        enterPressedRef.current = false
      }
      if (res.data.found) {
        scheduleHistory(q.trim(), firstWordId, true)
      }
    } catch {
      if (q !== currentQueryRef.current) return
      setResult({ prefix_group: [], inner_group: [], found: false, query: q, total: 0 })
    } finally {
      if (q === currentQueryRef.current) setLoading(false)
    }
  }, [scheduleMissedReport, scheduleHistory])

  const handleOcrFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setOcrLoading(true)
    setOcrResult(null)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      const r = await scanOcr({ image_base64: b64, mime_type: file.type || 'image/jpeg' })
      setOcrResult(r.data)
    } catch (err) {
      setOcrResult({ error: err.response?.data?.detail || 'เกิดข้อผิดพลาด' })
    }
    setOcrLoading(false)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setQuery(v)
    enterPressedRef.current = false
    doSearch(v)
  }

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || !query.trim()) return
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
    if (result && result.query === query.trim()) {
      const firstWordId = result.prefix_group?.[0]?.id ?? result.inner_group?.[0]?.id ?? null
      if (!result.found) {
        reportMissedSearch(query.trim()).catch(() => {})
      } else {
        recordHistoryNow(query.trim(), firstWordId, true)
      }
    } else {
      enterPressedRef.current = true
    }
  }

  const filterByCategory = (words) =>
    category === 'ทั้งหมด' ? words : words.filter((w) => w.category === category)

  const prefix = result ? filterByCategory(result.prefix_group) : []
  const inner = result ? filterByCategory(result.inner_group) : []

  // รอ fetchMe หรือยังไม่มี token → แสดง loading / null
  if (token && fetchingMe) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <div className="text-gray-400">กำลังโหลด...</div>
    </div>
  )
  if (!token) return null

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="font-chinese text-white text-2xl font-bold mb-4 text-center">
          字典 พจนานุกรมจีน-ไทย
        </h1>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="ค้นหาภาษาจีน พินอิน หรือไทย..."
              className="w-full rounded-xl px-4 py-3 pr-10 text-gray-800 bg-white shadow-lg text-base focus:outline-none focus:ring-2 focus:ring-chinese-gold"
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResult(null); sessionStorage.removeItem('search_result') }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => ocrInputRef.current?.click()}
            disabled={ocrLoading}
            className="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white text-xl shadow-lg transition-colors disabled:opacity-50"
          >
            {ocrLoading ? '⏳' : '📷'}
          </button>
          <input
            ref={ocrInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleOcrFile}
          />
        </div>
      </div>

      {/* OCR Result */}
      {ocrResult && (
        <div className="mx-4 mt-3 bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-medium text-gray-700">ผลการสแกน OCR</span>
            <button onClick={() => setOcrResult(null)} className="text-gray-400 text-xl">×</button>
          </div>
          {ocrResult.error ? (
            <p className="px-4 py-3 text-sm text-red-500">{ocrResult.error}</p>
          ) : !ocrResult.text ? (
            <p className="px-4 py-3 text-sm text-gray-400">ไม่พบข้อความภาษาจีนในรูป</p>
          ) : (
            <div className="px-4 py-3 space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">ข้อความที่อ่านได้</p>
                <p className="font-chinese text-lg text-gray-800 leading-relaxed">{ocrResult.text}</p>
              </div>
              {ocrResult.translation && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">คำแปล</p>
                  <p className="text-sm text-gray-700">{ocrResult.translation}</p>
                </div>
              )}
              {ocrResult.words?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">คำศัพท์ที่พบใน DB ({ocrResult.words.length} คำ)</p>
                  <div className="space-y-1.5">
                    {ocrResult.words.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => navigate(`/word/${w.id}`)}
                        className="w-full text-left bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-3 active:bg-gray-100"
                      >
                        <span className="font-chinese text-xl text-chinese-red w-10 shrink-0">{w.chinese}</span>
                        <span className="text-xs text-gray-500">{w.pinyin}</span>
                        <span className="text-xs text-gray-700 line-clamp-1 ml-auto">{w.thai_meaning?.split('\n')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Category filter */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {sortedCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setCategory(cat)
              if (cat !== 'ทั้งหมด') {
                const updated = { ...catUsage, [cat]: (catUsage[cat] || 0) + 1 }
                setCatUsage(updated)
                localStorage.setItem('cat_usage', JSON.stringify(updated))
              }
            }}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              category === cat
                ? 'bg-chinese-red text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="px-4 space-y-4">
        {loading && (
          <div className="text-center text-gray-400 py-8">กำลังค้นหา...</div>
        )}

        {result && !loading && (
          <>
            {!result.found && (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🔍</div>
                <p className="text-gray-500">ไม่พบคำว่า "<strong>{result.query}</strong>"</p>
                <p className="text-sm text-gray-400 mt-1">บันทึกไว้ให้ Admin เพิ่มให้นะครับ</p>
              </div>
            )}

            {prefix.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                  คำที่ขึ้นต้นด้วย "{result.query}"
                </h2>
                <div className="space-y-2">
                  {prefix.map((w) => <WordCard key={w.id} word={w} />)}
                </div>
              </div>
            )}

            {inner.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  คำที่มี "{result.query}" อยู่ข้างใน
                </h2>
                <div className="space-y-2">
                  {inner.map((w) => <WordCard key={w.id} word={w} />)}
                </div>
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          randomWords.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-gray-400">คำศัพท์วันนี้</span>
                <button
                  onClick={() => getRandomWords(30).then((r) => setRandomWords(r.data)).catch(() => {})}
                  className="text-xs text-chinese-red"
                >
                  สุ่มใหม่
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {randomWords.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => navigate(`/word/${w.id}`)}
                    className="bg-white rounded-xl p-3 text-left shadow-sm border border-gray-100 active:scale-95 transition-transform"
                  >
                    <div className="font-chinese text-2xl text-chinese-red leading-tight">{w.chinese}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{w.pinyin}</div>
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2 leading-snug">
                      {w.thai_meaning.split('\n')[0]}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <div className="font-chinese text-6xl text-chinese-red/20 mb-4">字</div>
              <p>พิมพ์คำที่ต้องการค้นหา</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
