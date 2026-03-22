import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchWords, reportMissedSearch, recordSearchHistory, getRandomWords, scanOcr, getFavorites, getPublicSettings } from '../services/api'
import { offlineSearch, recordLocalHistory } from '../services/offlineDb'
import { startBackgroundSync, getSyncProgress } from '../services/syncService'
import WordCard from '../components/WordCard'
import MarqueeText from '../components/MarqueeText'
import WordImageGridCard from '../components/WordImageGridCard'
import TonedChinese from '../components/TonedChinese'
import HandwritingModal from '../components/HandwritingModal'
import OfflineAlert from '../components/OfflineAlert'
import { isOnline } from '../utils/network'
import QuotaLimitModal from '../components/QuotaLimitModal'
import { SEARCH_CATEGORIES, getCategoryColor, loadFavCategories } from '../utils/categories'
import useAuthStore from '../stores/authStore'

function loadCatUsage() {
  try { return JSON.parse(localStorage.getItem('cat_usage') || '{}') } catch { return {} }
}

const currentMonth = () => new Date().toISOString().slice(0, 7) // "2026-03"

function setSearchQuotaExceeded(tier) {
  try { localStorage.setItem('search_quota_exceeded', JSON.stringify({ month: currentMonth(), tier })) } catch {}
}

function getSearchQuotaExceeded() {
  try {
    const v = JSON.parse(localStorage.getItem('search_quota_exceeded'))
    if (v?.month === currentMonth()) return v
    localStorage.removeItem('search_quota_exceeded') // ผ่านเดือนแล้ว → ลบทิ้ง
  } catch {}
  return null
}

function clearSearchQuotaExceeded() {
  try { localStorage.removeItem('search_quota_exceeded') } catch {}
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
  const [favCategories] = useState(loadFavCategories)
  const [categoryGridConfig, setCategoryGridConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_grid_config') || '{}') } catch { return {} }
  })
  const [categoryCounts, setCategoryCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('category_counts') || '{}') } catch { return {} }
  })
  const [ocrResult, setOcrResult] = useState(null)  // { text, translation, words }
  const [ocrLoading, setOcrLoading] = useState(false)
  const [quotaModal, setQuotaModal] = useState(null) // null | { quotaType, userTier }
  const [showOcrSheet, setShowOcrSheet] = useState(false)
  const [showHandwriting, setShowHandwriting] = useState(false)
  const [showOfflineAlert, setShowOfflineAlert] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState(new Set())
  const ocrInputRef = useRef(null)    // album (no capture)
  const ocrCameraRef = useRef(null)  // camera only

  const sortedCategories = [
    'ทั้งหมด',
    ...favCategories.filter(c => (categoryCounts[c] || 0) > 0),
    ...SEARCH_CATEGORIES
      .filter(c => c !== 'ทั้งหมด' && !favCategories.includes(c) && (categoryCounts[c] || 0) > 0)
      .sort((a, b) => (catUsage[b] || 0) - (catUsage[a] || 0)),
  ]

  const missedTimerRef = useRef(null)
  const historyTimerRef = useRef(null)
  const emptyTimerRef = useRef(null)
  const currentQueryRef = useRef('')
  const enterPressedRef = useRef(false)

  useEffect(() => () => {
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
    clearTimeout(emptyTimerRef.current)
  }, [])

  const refreshRandom = useCallback((cat) => {
    getRandomWords(30, cat)
      .then((r) => {
        if (r.data.length === 0 && cat && cat !== 'ทั้งหมด') {
          // category นี้ไม่มีคำ → fallback ทั้งหมด
          return getRandomWords(30, null).then((r2) => setRandomWords(r2.data))
        }
        setRandomWords(r.data)
      })
      .catch((e) => {
        const detail = e.response?.data?.detail
        if (e.response?.status === 429 && detail) {
          setQuotaModal({ quotaType: detail.quota_type, userTier: detail.user_tier })
        }
      })
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

  // โหลดคำสุ่มตอนเปิดครั้งแรก (ไม่สนใจ query — random แค่ hide ใน UI ถ้ามี result อยู่)
  useEffect(() => {
    if (!token) return
    refreshRandom(category)
  }, [token])

  // โหลด favorites เพื่อแสดง ⭐ และเรียงก่อน
  useEffect(() => {
    if (!token) return
    getFavorites().then((r) => setFavoriteIds(new Set(r.data.map((f) => f.word_id)))).catch(() => {})
  }, [token])

  // Background sync สำหรับ offline search
  useEffect(() => {
    startBackgroundSync().catch(() => {})
  }, [])

  // โหลด public settings สำหรับ category grid config (อัพเดต cache ด้วย)
  useEffect(() => {
    getPublicSettings()
      .then(r => {
        const cfg = r.data?.category_grid_config
        if (cfg && typeof cfg === 'object') {
          setCategoryGridConfig(cfg)
          try { localStorage.setItem('admin_grid_config', JSON.stringify(cfg)) } catch { /* ignore */ }
        }
        const counts = r.data?.category_counts
        if (counts && typeof counts === 'object') {
          setCategoryCounts(counts)
          try { localStorage.setItem('category_counts', JSON.stringify(counts)) } catch { /* ignore */ }
        }
      })
      .catch(() => {})
  }, [])

  const scheduleMissedReport = useCallback((q) => {
    clearTimeout(missedTimerRef.current)
    if (enterPressedRef.current) {
      enterPressedRef.current = false
      reportMissedSearch(q).catch(() => {})
    } else {
      missedTimerRef.current = setTimeout(() => {
        reportMissedSearch(q).catch(() => {})
      }, 3000)
    }
  }, [])

  const handleSearchQuota429 = useCallback((e) => {
    const detail = e.response?.data?.detail
    if (e.response?.status === 429 && detail) {
      setSearchQuotaExceeded(detail.user_tier)
      setQuotaModal({ quotaType: detail.quota_type, userTier: detail.user_tier })
    }
  }, [])

  const scheduleHistory = useCallback((q, wordId, pinyin, found) => {
    clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => {
      recordSearchHistory(q, wordId, found).catch(handleSearchQuota429)
      recordLocalHistory({ query: q, result_word_id: wordId ?? null, result_word_pinyin: pinyin ?? null, found }).catch(() => {})
    }, 3000)
  }, [handleSearchQuota429])

  const recordHistoryNow = useCallback((q, wordId, pinyin, found) => {
    clearTimeout(historyTimerRef.current)
    recordSearchHistory(q, wordId, found).catch(handleSearchQuota429)
    recordLocalHistory({ query: q, result_word_id: wordId ?? null, result_word_pinyin: pinyin ?? null, found }).catch(() => {})
  }, [handleSearchQuota429])

  const doSearch = useCallback(async (q) => {
    currentQueryRef.current = q
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
    if (!q.trim()) { setResult(null); return }
    setLoading(true)
    try {
      let resultData
      if (!navigator.onLine && getSyncProgress().synced_at) {
        const exceeded = getSearchQuotaExceeded()
        if (exceeded) {
          setQuotaModal({ quotaType: 'search_daily', userTier: exceeded.tier })
          setLoading(false)
          return
        }
        resultData = await offlineSearch(q.trim())
        const firstWord = resultData.prefix_group?.[0] ?? resultData.inner_group?.[0] ?? null
        clearTimeout(historyTimerRef.current)
        historyTimerRef.current = setTimeout(() => {
          recordLocalHistory({ query: q.trim(), result_word_id: firstWord?.id ?? null, result_word_pinyin: firstWord?.pinyin ?? null, found: resultData.found }).catch(() => {})
        }, 3000)
      } else {
        const res = await searchWords(q.trim())
        resultData = res.data
        clearSearchQuotaExceeded()
      }
      if (q !== currentQueryRef.current) return
      setResult(resultData)
      const res = { data: resultData }
      const perCharWords = res.data.per_char_groups?.flatMap(g => [...g.prefix_group, ...g.inner_group]) ?? []
      const firstWordId =
        res.data.prefix_group?.[0]?.id ??
        res.data.inner_group?.[0]?.id ??
        perCharWords[0]?.id ?? null

      // นับหมวดหมู่จากผลค้นหา เพื่อให้หมวดที่ค้นบ่อยขึ้นมาด้านหน้า
      if (res.data.found) {
        const allWords = [...(res.data.prefix_group || []), ...(res.data.inner_group || []), ...perCharWords]
        const catCounts = {}
        allWords.forEach((w) => { if (w.category) catCounts[w.category] = (catCounts[w.category] || 0) + 1 })
        if (Object.keys(catCounts).length > 0) {
          setCatUsage((prev) => {
            const updated = { ...prev }
            Object.entries(catCounts).forEach(([cat, cnt]) => { updated[cat] = (updated[cat] || 0) + cnt })
            localStorage.setItem('cat_usage', JSON.stringify(updated))
            return updated
          })
        }
      }

      const effectivelyNotFound = !res.data.found || res.data.search_mode === 'per_char'
      if (effectivelyNotFound) {
        scheduleMissedReport(q.trim())
      } else {
        enterPressedRef.current = false
        const fw = res.data.prefix_group?.[0] ?? res.data.inner_group?.[0] ?? null
        scheduleHistory(q.trim(), firstWordId, fw?.pinyin ?? null, true)
      }
    } catch (err) {
      if (q !== currentQueryRef.current) return
      const detail = err.response?.data?.detail
      if (err.response?.status === 429 && detail?.quota_type) {
        setSearchQuotaExceeded(detail.user_tier)
        setQuotaModal({ quotaType: detail.quota_type, userTier: detail.user_tier })
        return
      }
      // ถ้า network error + มี offline data → fallback
      if (getSyncProgress().synced_at) {
        try {
          const offlineResult = await offlineSearch(q.trim())
          if (q === currentQueryRef.current) setResult(offlineResult)
          return
        } catch { /* ignore */ }
      }
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
      if (!err.response) {
        setShowOfflineAlert(true)
      } else if (err.response?.status === 429) {
        const detail = err.response.data?.detail
        setQuotaModal({ quotaType: detail?.quota_type, userTier: detail?.user_tier })
      } else {
        setOcrResult({ error: err.response?.data?.detail || 'เกิดข้อผิดพลาด' })
      }
    }
    setOcrLoading(false)
  }

  const handleChange = (e) => {
    const v = e.target.value
    setQuery(v)
    enterPressedRef.current = false
    if (!v) {
      clearTimeout(emptyTimerRef.current)
      emptyTimerRef.current = setTimeout(() => refreshRandom(category), 4000)
    } else {
      clearTimeout(emptyTimerRef.current)
    }
    doSearch(v)
  }

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || !query.trim()) return
    clearTimeout(missedTimerRef.current)
    clearTimeout(historyTimerRef.current)
    if (result && result.query === query.trim()) {
      const firstWordId = result.prefix_group?.[0]?.id ?? result.inner_group?.[0]?.id ?? null
      const isPerChar = result.search_mode === 'per_char'
      if (!result.found || isPerChar) {
        reportMissedSearch(query.trim()).catch(() => {})
      } else {
        const firstWordPinyin = result.prefix_group?.[0]?.pinyin ?? result.inner_group?.[0]?.pinyin ?? null
        recordHistoryNow(query.trim(), firstWordId, firstWordPinyin, true)
      }
    } else {
      enterPressedRef.current = true
    }
  }

  const filterByCategory = (words) =>
    category === 'ทั้งหมด' ? words : words.filter((w) => w.category === category)

  const isGridMode = !!categoryGridConfig[category] && category !== 'ทั้งหมด'

  const renderWordList = (words) => isGridMode ? (
    <div className="grid grid-cols-2 gap-2">
      {words.map((w) => <WordImageGridCard key={w.id} word={w} />)}
    </div>
  ) : (
    <div className="space-y-2">
      {words.map((w) => (
        <WordCard
          key={w.id}
          word={w}
          starred={favoriteIds.has(w.id)}
          onNavigate={(w) => recordHistoryNow(query.trim(), w.id, w.pinyin ?? null, true)}
        />
      ))}
    </div>
  )

  const sortFav = (words) =>
    favoriteIds.size === 0 ? words : [...words].sort((a, b) => (favoriteIds.has(b.id) ? 1 : 0) - (favoriteIds.has(a.id) ? 1 : 0))

  const prefix = result ? sortFav(filterByCategory(result.prefix_group)).slice(0, 30) : []
  const inner = result ? sortFav(filterByCategory(result.inner_group)).slice(0, 30) : []

  // รอ fetchMe หรือยังไม่มี token → แสดง loading / null
  if (token && fetchingMe) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <div className="text-gray-400">กำลังโหลด...</div>
    </div>
  )
  if (!token) return null

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {quotaModal && (
        <QuotaLimitModal
          quotaType={quotaModal.quotaType}
          userTier={quotaModal.userTier}
          onClose={() => setQuotaModal(null)}
        />
      )}
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="font-chinese text-white text-2xl font-bold mb-4 text-center">
          字典 พจนานุกรมจีน-ไทย
        </h1>
        <div className="flex gap-2">
          {/* ปุ่มเขียนด้วยมือ */}
          <button
            onClick={() => navigator.onLine ? setShowHandwriting(true) : setShowOfflineAlert(true)}
            className="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center shadow-lg transition-colors shrink-0"
            title="เขียนด้วยมือ"
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          <div className="relative flex-1 bg-white rounded-xl shadow-lg focus-within:ring-2 focus-within:ring-chinese-gold">
            {!query && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3">
                <span className="text-gray-400 text-sm leading-tight">汉字 · Pinyin · ไทย</span>
                <span className="text-gray-300 text-[11px] leading-tight mt-0.5">ใช้ "@" แทนตำแหน่งได้</span>
              </div>
            )}
            <input
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder=""
              className="w-full rounded-xl px-4 py-3 pr-10 text-gray-800 bg-transparent text-base focus:outline-none"
              autoFocus
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('')
                  setResult(null)
                  sessionStorage.removeItem('search_result')
                  clearTimeout(emptyTimerRef.current)
                  emptyTimerRef.current = setTimeout(() => refreshRandom(category), 4000)
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => setShowOcrSheet(true)}
            disabled={ocrLoading}
            className="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center shadow-lg transition-colors disabled:opacity-50"
          >
            {ocrLoading ? (
              <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : (
              <svg className="w-7 h-7 text-white" viewBox="0 0 28 28" fill="none">
                {/* body กล้อง */}
                <rect x="2" y="8" width="24" height="17" rx="3.5" fill="currentColor" opacity="0.9"/>
                {/* ส่วนยื่น viewfinder */}
                <path d="M9 8V6.5C9 5.67 9.67 5 10.5 5h7C18.33 5 19 5.67 19 6.5V8" fill="currentColor" opacity="0.9"/>
                {/* เลนส์วงใหญ่ */}
                <circle cx="14" cy="16.5" r="5.5" fill="white" opacity="0.15"/>
                <circle cx="14" cy="16.5" r="4.5" stroke="white" strokeWidth="2"/>
                {/* เลนส์วงในสะท้อนแสง */}
                <circle cx="14" cy="16.5" r="2.5" fill="white" opacity="0.25"/>
                {/* แฟลช */}
                <circle cx="22" cy="11" r="1.2" fill="white" opacity="0.6"/>
              </svg>
            )}
          </button>
          <input
            ref={ocrInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleOcrFile}
          />
          <input
            ref={ocrCameraRef}
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
              {/* Thai translation first */}
              {ocrResult.translation && (
                <div>
                  {ocrResult.translation.split('\n').map((t, i) => (
                    t.trim()
                      ? <p key={i} className="text-sm text-gray-700 leading-snug">{t}</p>
                      : <div key={i} className="h-2" />
                  ))}
                </div>
              )}
              {/* Chinese reference below */}
              {ocrResult.text && (
                <div className="border-t border-gray-100 pt-2">
                  {ocrResult.text.split('\n').map((t, i) => (
                    t.trim()
                      ? <p key={i} className="font-chinese text-sm text-gray-400 leading-snug">{t}</p>
                      : <div key={i} className="h-1" />
                  ))}
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
        {sortedCategories.map((cat) => {
          const isFav = favCategories.includes(cat)
          const isActive = category === cat
          const color = isFav ? getCategoryColor(cat) : null
          return (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat)
                if (cat !== 'ทั้งหมด') {
                  const updated = { ...catUsage, [cat]: (catUsage[cat] || 0) + 1 }
                  setCatUsage(updated)
                  localStorage.setItem('cat_usage', JSON.stringify(updated))
                }
                if (!query) refreshRandom(cat)
              }}
              style={isFav && !isActive ? { borderColor: color, borderWidth: 2 } : undefined}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                isActive
                  ? 'bg-chinese-red text-white border-transparent'
                  : isFav
                  ? 'bg-white text-gray-700'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      {showOfflineAlert && <OfflineAlert onClose={() => setShowOfflineAlert(false)} />}

      {/* Handwriting Modal */}
      {showHandwriting && (
        <HandwritingModal
          onConfirm={(text) => {
            const newQuery = query + text
            setQuery(newQuery)
            doSearch(newQuery)
          }}
          onClose={() => setShowHandwriting(false)}
        />
      )}

      {/* OCR Mode Sheet */}
      {showOcrSheet && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center px-6"
          onClick={() => setShowOcrSheet(false)}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-sm bg-white rounded-2xl px-4 pt-5 pb-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
            <p className="text-sm font-semibold text-gray-600 mb-3 text-center">เลือกโหมด OCR</p>
            <div className="space-y-3">
              <button
                onClick={() => { setShowOcrSheet(false); if (!isOnline()) { setShowOfflineAlert(true); return; } navigate('/ocr/live') }}
                className="w-full flex items-center gap-4 bg-chinese-red/5 border border-chinese-red/20 rounded-2xl px-4 py-4 active:scale-95 transition-transform"
              >
                <div className="w-12 h-12 bg-chinese-red rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="3.5" />
                    <path strokeLinecap="round" d="M6.5 3h-2A1.5 1.5 0 003 4.5v2M17.5 3h2A1.5 1.5 0 0121 4.5v2M3 17.5v2A1.5 1.5 0 004.5 21h2M21 17.5v2a1.5 1.5 0 01-1.5 1.5h-2" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-800">ส่องกล้อง Live</p>
                  <p className="text-xs text-gray-400 mt-0.5">สแกนอัตโนมัติ แปลแบบ Realtime</p>
                </div>
              </button>
              <button
                onClick={() => { setShowOcrSheet(false); if (!isOnline()) { setShowOfflineAlert(true); return } ocrCameraRef.current?.click() }}
                className="w-full flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4 active:scale-95 transition-transform"
              >
                <div className="w-12 h-12 bg-gray-700 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-white" viewBox="0 0 28 28" fill="none">
                    <rect x="2" y="8" width="24" height="17" rx="3.5" fill="currentColor" opacity="0.9"/>
                    <path d="M9 8V6.5C9 5.67 9.67 5 10.5 5h7C18.33 5 19 5.67 19 6.5V8" fill="currentColor" opacity="0.9"/>
                    <circle cx="14" cy="16.5" r="4.5" stroke="white" strokeWidth="2"/>
                    <circle cx="14" cy="16.5" r="2.5" fill="white" opacity="0.25"/>
                    <circle cx="22" cy="11" r="1.2" fill="white" opacity="0.6"/>
                  </svg>
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-800">ถ่ายรูป</p>
                  <p className="text-xs text-gray-400 mt-0.5">เปิดกล้องถ่ายภาพทันที</p>
                </div>
              </button>
              <button
                onClick={() => { setShowOcrSheet(false); if (!isOnline()) { setShowOfflineAlert(true); return } ocrInputRef.current?.click() }}
                className="w-full flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4 active:scale-95 transition-transform"
              >
                <div className="w-12 h-12 bg-gray-500 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9H18.75" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-800">เลือกจากอัลบัม</p>
                  <p className="text-xs text-gray-400 mt-0.5">เลือกรูปที่มีอยู่แล้วในโทรศัพท์</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

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

            {/* Position search results */}
            {result.search_mode === 'position' && prefix.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                  @คำที่ค้นหาได้
                </h2>
                {renderWordList(prefix)}
              </div>
            )}

            {/* Normal / mixed search results */}
            {result.search_mode !== 'position' && result.search_mode !== 'per_char' && (
              <>
                {prefix.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                      คำที่ขึ้นต้นด้วย "{result.query}"
                    </h2>
                    {renderWordList(prefix)}
                  </div>
                )}
                {inner.length > 0 && (
                  <div>
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      คำที่มี "{result.query}" อยู่ข้างใน
                    </h2>
                    {renderWordList(inner)}
                  </div>
                )}
              </>
            )}

            {/* Per-char fallback results */}
            {result.search_mode === 'per_char' && (
              <div className="text-center py-4">
                <p className="text-gray-500 text-sm">ไม่พบคำว่า "<strong>{result.query}</strong>" ในพจนานุกรม</p>
                <p className="text-xs text-gray-400 mt-1">บันทึกไว้ให้ Admin เพิ่มให้นะครับ</p>
              </div>
            )}
            {result.search_mode === 'per_char' && result.per_char_groups?.map((group) => (
              <div key={group.char}>
                <h2 className="text-sm font-semibold text-gray-600 mb-2 mt-3">
                  ผลการค้นหา "<span className="font-chinese text-chinese-red">{group.char}</span>"
                </h2>
                {group.prefix_group?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-chinese-gold mb-1.5">คำที่ขึ้นต้นด้วย "{group.char}"</p>
                    {renderWordList(sortFav(filterByCategory(group.prefix_group)))}
                  </div>
                )}
                {group.inner_group?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">คำที่มี "{group.char}" อยู่ข้างใน</p>
                    {renderWordList(sortFav(filterByCategory(group.inner_group)))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {!result && !loading && (
          randomWords.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs text-gray-400">คำศัพท์วันนี้</span>
                <button onClick={() => refreshRandom(category)} className="text-xs text-chinese-red">
                  สุ่มใหม่
                </button>
              </div>

              {/* Grid with images mode */}
              {categoryGridConfig[category] ? (
                <div className="grid grid-cols-2 gap-2">
                  {randomWords.map((w) => (
                    <WordImageGridCard key={w.id} word={w} />
                  ))}
                </div>
              ) : (
                /* Normal grid (no images) */
                <div className="grid grid-cols-2 gap-2">
                  {randomWords.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => navigate(`/word/${w.id}`)}
                      className="bg-white rounded-xl p-3 text-left shadow-sm border border-gray-100 active:scale-95 transition-transform"
                    >
                      <TonedChinese chinese={w.chinese} pinyin={w.pinyin} className="font-chinese text-2xl leading-tight" />
                      <div className="text-[11px] text-gray-400 mt-0.5">{w.pinyin}</div>
                      <div className="text-xs text-gray-600 mt-1 line-clamp-2 leading-snug">
                        {w.thai_meaning.split('\n')[0]}
                      </div>
                    </button>
                  ))}
                </div>
              )}
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
