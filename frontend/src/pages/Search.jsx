import { useState, useCallback, useRef, useEffect } from 'react'
import { searchWords, reportMissedSearch, recordSearchHistory } from '../services/api'
import WordCard from '../components/WordCard'
import { SEARCH_CATEGORIES } from '../utils/categories'

function loadCatUsage() {
  try { return JSON.parse(localStorage.getItem('cat_usage') || '{}') } catch { return {} }
}

export default function Search() {
  const [query, setQuery] = useState(() => sessionStorage.getItem('search_query') || '')
  const [result, setResult] = useState(() => {
    const r = sessionStorage.getItem('search_result')
    return r ? JSON.parse(r) : null
  })
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState(() => sessionStorage.getItem('search_category') || 'ทั้งหมด')
  const [catUsage, setCatUsage] = useState(loadCatUsage)

  // เรียง categories ตามความนิยม ("ทั้งหมด" อยู่แรกเสมอ)
  const sortedCategories = [
    'ทั้งหมด',
    ...SEARCH_CATEGORIES.filter((c) => c !== 'ทั้งหมด')
      .sort((a, b) => (catUsage[b] || 0) - (catUsage[a] || 0)),
  ]

  const missedTimerRef = useRef(null)
  const historyTimerRef = useRef(null)
  const currentQueryRef = useRef('')   // ป้องกัน stale response ยิง timer ผิด
  const enterPressedRef = useRef(false) // user กด Enter → report ทันทีแทน 10s

  // ยกเลิก timer เมื่อ unmount
  useEffect(() => () => {
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
  }, [])

  // บันทึกสถานะค้นหาใน sessionStorage (ล้างเองเมื่อปิด browser)
  useEffect(() => { sessionStorage.setItem('search_query', query) }, [query])
  useEffect(() => {
    if (result) sessionStorage.setItem('search_result', JSON.stringify(result))
    else sessionStorage.removeItem('search_result')
  }, [result])
  useEffect(() => { sessionStorage.setItem('search_category', category) }, [category])

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
      // ถ้า query เปลี่ยนไปแล้ว (user พิมพ์ต่อ) → ทิ้ง response นี้
      if (q !== currentQueryRef.current) return
      setResult(res.data)
      const firstWordId = res.data.prefix_group?.[0]?.id ?? res.data.inner_group?.[0]?.id ?? null
      if (!res.data.found) {
        scheduleMissedReport(q.trim())
      } else {
        enterPressedRef.current = false
      }
      // บันทึก history เฉพาะเมื่อเจอคำ (มีคำแปล)
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
      // result พร้อม → บันทึกทันที
      const firstWordId = result.prefix_group?.[0]?.id ?? result.inner_group?.[0]?.id ?? null
      if (!result.found) {
        reportMissedSearch(query.trim()).catch(() => {})
      } else {
        recordHistoryNow(query.trim(), firstWordId, true)
      }
    } else {
      // API ยังโหลดอยู่ → ตั้ง flag
      enterPressedRef.current = true
    }
  }

  const filterByCategory = (words) =>
    category === 'ทั้งหมด' ? words : words.filter((w) => w.category === category)

  const prefix = result ? filterByCategory(result.prefix_group) : []
  const inner = result ? filterByCategory(result.inner_group) : []

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="font-chinese text-white text-2xl font-bold mb-4 text-center">
          字典 พจนานุกรมจีน-ไทย
        </h1>
        <div className="relative">
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
      </div>

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
          <div className="text-center py-16 text-gray-400">
            <div className="font-chinese text-6xl text-chinese-red/20 mb-4">字</div>
            <p>พิมพ์คำที่ต้องการค้นหา</p>
            <p className="text-sm mt-1">รองรับ จีน / พินอิน / ไทย</p>
          </div>
        )}
      </div>
    </div>
  )
}
