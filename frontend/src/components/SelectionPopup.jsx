import { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { searchWords, reportMissedSearchDirect } from '../services/api'
import WordCard from './WordCard'
import TonedChinese from './TonedChinese'

const CHINESE_RE = /[\u4e00-\u9fff]/
const THAI_RE = /[\u0e00-\u0e7f]/
const isSearchable = (t) => CHINESE_RE.test(t) || THAI_RE.test(t)

export default function SelectionPopup() {
  const [selText, setSelText] = useState('')       // ข้อความที่เลือกอยู่ (แสดงปุ่ม)
  const [iconPos, setIconPos] = useState(null)     // {x, y} ตำแหน่งปุ่ม (viewport)
  const [query, setQuery] = useState('')           // query ที่กำลังค้นหา (แสดงผล)
  const [result, setResult] = useState(null)       // {prefix_group, inner_group, found}
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  // ref เก็บข้อความล่าสุดที่เลือก — ใช้ใน handleSearch กัน race condition บน mobile
  const selTextRef = useRef('')
  // cache ผลจาก background search — พอกดปุ่มแสดงได้เลย ไม่ต้องรอ
  const bgResultRef = useRef(null)
  const location = useLocation()

  // ตรวจจับการเลือกข้อความ
  useEffect(() => {
    let timer = null
    let lastMouseUp = 0

    const checkSelection = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim()
      if (text && isSearchable(text) && text.length <= 20) {
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          setIconPos({ x: rect.left + rect.width / 2, y: rect.bottom + 10 })
        } catch {
          setIconPos(null)
        }
        selTextRef.current = text
        bgResultRef.current = null  // reset cache สำหรับ selection ใหม่
        setSelText(text)
      } else {
        selTextRef.current = ''
        bgResultRef.current = null
        setSelText('')
        setIconPos(null)
      }
    }

    // Desktop: mouseup → check ทันที
    const onMouseUp = () => {
      lastMouseUp = Date.now()
      clearTimeout(timer)
      timer = setTimeout(checkSelection, 10)
    }

    // Mobile: selectionchange (ลาก handle) → debounce 300ms
    // ถ้าเพิ่ง mouseup มา < 200ms = desktop selection → ข้าม
    const onSelectionChange = () => {
      if (Date.now() - lastMouseUp < 200) return
      clearTimeout(timer)
      timer = setTimeout(checkSelection, 300)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(timer)
    }
  }, [])

  // ปิด popup เมื่อ navigate ไปหน้าอื่น (เช่น กด WordCard)
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setResult(null)
    selTextRef.current = ''
    setSelText('')
    setIconPos(null)
  }, [location.pathname])

  // Helper: ค้นหาทุกตัวอักษรในคำ → คืนผลแยกรายตัว
  const searchByChars = useCallback(async (text, excludeIds = new Set()) => {
    const chars = [...new Set(text.split('').filter(isSearchable))]
    const results = await Promise.all(
      chars.map((c) => searchWords(c).catch(() => searchWords(c).catch(() => null)))
    )
    const char_results = []
    for (let i = 0; i < chars.length; i++) {
      const r = results[i]
      if (!r) continue
      const prefix_group = (r.data?.prefix_group || []).filter((w) => !excludeIds.has(w.id))
      const inner_group = (r.data?.inner_group || []).filter((w) => !excludeIds.has(w.id))
      if (prefix_group.length + inner_group.length > 0) {
        char_results.push({ char: chars[i], prefix_group, inner_group })
      }
    }
    return { char_results }
  }, [])

  // Background search ทันทีที่เลือกข้อความ — auto-report ถ้าไม่เจอ + cache ผลไว้
  useEffect(() => {
    if (!selText) return
    const captured = selText

    searchWords(captured)
      .then(async (r) => {
        const raw_prefix = r.data?.prefix_group || []
        const raw_inner = r.data?.inner_group || []

        // กรอง: เฉพาะคำที่ chinese จริงๆ มี query อยู่ (ป้องกัน thai_meaning false positive)
        const isChineseQuery = CHINESE_RE.test(captured)
        const prefix_group = isChineseQuery
          ? raw_prefix.filter((w) => w.chinese?.startsWith(captured))
          : raw_prefix
        const inner_group = isChineseQuery
          ? raw_inner.filter((w) => w.chinese?.includes(captured) && !w.chinese?.startsWith(captured))
          : raw_inner

        if (captured.length > 1) {
          if (isChineseQuery) {
            const hasExactMatch = prefix_group.some((w) => w.chinese === captured)
            if (hasExactMatch || prefix_group.length + inner_group.length > 0) {
              // มีผลอยู่แล้ว → ข้าม per-char เพื่อความเร็ว
              bgResultRef.current = { prefix_group, inner_group, found: true }
            } else {
              // ไม่เจอเลย → per-char fallback
              const fb = await searchByChars(captured, new Set())
              const hasResults = fb.char_results.length > 0
              bgResultRef.current = { prefix_group: [], inner_group: [], char_results: fb.char_results, found: hasResults }
              reportMissedSearchDirect(captured).catch(() => {})
            }
          } else {
            // Thai/other: แสดงผลรวมตรงๆ ไม่ต้องแยกทีละตัวอักษร
            const hasResults = prefix_group.length + inner_group.length > 0
            bgResultRef.current = { prefix_group, inner_group, found: hasResults }
            if (!hasResults) reportMissedSearchDirect(captured).catch(() => {})
          }
          return
        }

        // single char
        if (prefix_group.length + inner_group.length > 0) {
          bgResultRef.current = { prefix_group, inner_group, found: true }
        } else {
          bgResultRef.current = { prefix_group: [], inner_group: [], found: false }
          reportMissedSearchDirect(captured).catch(() => {})
        }
      })
      .catch(() => {})
  }, [selText, searchByChars])

  // ค้นหาเมื่อ query เปลี่ยน (เฉพาะกรณี background search ยังไม่เสร็จ)
  useEffect(() => {
    if (!query) return
    if (!loading) return
    setResult(null)
    const captured = query

    searchWords(captured)
      .then(async (r) => {
        const raw_prefix = r.data?.prefix_group || []
        const raw_inner = r.data?.inner_group || []

        const isChineseQuery = CHINESE_RE.test(captured)
        const prefix_group = isChineseQuery
          ? raw_prefix.filter((w) => w.chinese?.startsWith(captured))
          : raw_prefix
        const inner_group = isChineseQuery
          ? raw_inner.filter((w) => w.chinese?.includes(captured) && !w.chinese?.startsWith(captured))
          : raw_inner

        if (captured.length > 1) {
          if (isChineseQuery) {
            if (prefix_group.length + inner_group.length > 0) {
              setResult({ prefix_group, inner_group, found: true })
            } else {
              const fb = await searchByChars(captured, new Set())
              const hasResults = fb.char_results.length > 0
              setResult({ prefix_group: [], inner_group: [], char_results: fb.char_results, found: hasResults })
              reportMissedSearchDirect(captured).catch(() => {})
            }
          } else {
            const hasResults = prefix_group.length + inner_group.length > 0
            setResult({ prefix_group, inner_group, found: hasResults })
            if (!hasResults) reportMissedSearchDirect(captured).catch(() => {})
          }
          return
        }

        if (prefix_group.length + inner_group.length > 0) {
          setResult({ prefix_group, inner_group, found: true })
        } else {
          setResult({ prefix_group: [], inner_group: [], found: false })
          reportMissedSearchDirect(captured).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [query, searchByChars])

  const handleSearch = useCallback(() => {
    const text = selTextRef.current
    if (!text) return
    selTextRef.current = ''
    setSelText('')
    setIconPos(null)
    setOpen(true)
    // ถ้า background search เสร็จแล้ว → แสดงผลเลย ไม่ต้องรอ
    if (bgResultRef.current !== null) {
      setResult(bgResultRef.current)
      setLoading(false)
      bgResultRef.current = null
    } else {
      // ยังไม่เสร็จ → ให้ useEffect([query]) จัดการ
      setLoading(true)
    }
    setQuery(text)
    window.getSelection()?.removeAllRanges()
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResult(null)
    selTextRef.current = ''
    setSelText('')
    setIconPos(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  return (
    <>
      {/* ปุ่มแว่นขยายลอย — แสดงเมื่อมีข้อความเลือกอยู่ */}
      {selText && !open && iconPos && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSearch}
          style={{
            position: 'fixed',
            left: iconPos.x,
            top: iconPos.y,
            transform: 'translateX(-50%)',
            zIndex: 60,
          }}
          className="bg-chinese-red text-white rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-xl text-sm font-medium select-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <span className="font-chinese">{selText}</span>
        </button>
      )}

      {/* Bottom sheet ผลการค้นหา */}
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={close} />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 bg-chinese-cream rounded-t-2xl shadow-2xl flex flex-col"
            style={{ height: '67vh' }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-200 flex-shrink-0 bg-white">
              <div className="text-sm text-gray-500">
                ค้นหา:{' '}
                <span className="font-chinese text-gray-900 text-base font-semibold">{query}</span>
              </div>
              <button onClick={close} className="text-gray-400 text-xl leading-none px-1">✕</button>
            </div>

            {/* ผลการค้นหา */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
              {loading && (
                <div className="text-center text-gray-400 py-8">กำลังค้นหา...</div>
              )}

              {result && !loading && (
                <>
                  {!result.found && (
                    <div className="text-center py-12">
                      <div className="text-5xl mb-4">🔍</div>
                      <p className="text-gray-500">ไม่พบคำว่า "<strong>{query}</strong>"</p>
                      <p className="text-sm text-gray-400 mt-1">บันทึกไว้ให้ Admin เพิ่มให้นะครับ</p>
                    </div>
                  )}

                  {result.found && (() => {
                    const exactMatch = result.prefix_group?.find((w) => w.chinese === query)
                    if (exactMatch) {
                      // เจอตรงๆ → แสดงแค่ตัวนั้นเลย
                      return <WordCard key={exactMatch.id} word={exactMatch} />
                    }

                    return (
                      <>
                        {/* per-char sections ก่อน (multi-char queries) */}
                        {result.char_results?.map(({ char, prefix_group, inner_group }) => {
                          const charWord = [...prefix_group, ...inner_group].find((w) => w.chinese === char)
                          return (
                          <div key={char} className="space-y-3">
                            <div className="flex items-center gap-2">
                              <TonedChinese chinese={char} pinyin={charWord?.pinyin} className="font-chinese text-xl font-bold" />
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            {prefix_group.length > 0 && (
                              <div>
                                <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                                  คำที่ขึ้นต้นด้วย "{char}"
                                </h2>
                                <div className="space-y-2">
                                  {prefix_group.map((w) => <WordCard key={w.id} word={w} />)}
                                </div>
                              </div>
                            )}
                            {inner_group.length > 0 && (
                              <div>
                                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                                  คำที่มี "{char}" อยู่ข้างใน
                                </h2>
                                <div className="space-y-2">
                                  {inner_group.map((w) => <WordCard key={w.id} word={w} />)}
                                </div>
                              </div>
                            )}
                          </div>
                        )})}

                        {/* combined sections: คำที่มี query ทั้งชุด */}
                        {result.prefix_group?.length > 0 && (
                          <div>
                            <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                              คำที่ขึ้นต้นด้วย "{query}"
                            </h2>
                            <div className="space-y-2">
                              {result.prefix_group.map((w) => (
                                <WordCard key={w.id} word={w} />
                              ))}
                            </div>
                          </div>
                        )}
                        {result.inner_group?.length > 0 && (
                          <div>
                            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                              คำที่มี "{query}" อยู่ข้างใน
                            </h2>
                            <div className="space-y-2">
                              {result.inner_group.map((w) => (
                                <WordCard key={w.id} word={w} />
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
