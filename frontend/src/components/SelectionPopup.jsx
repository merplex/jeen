import { useEffect, useState, useCallback, useRef } from 'react'
import { searchWords, reportMissedSearchDirect } from '../services/api'
import WordCard from './WordCard'

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
        setSelText(text)
      } else {
        selTextRef.current = ''
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

  // ค้นหาเมื่อ query เปลี่ยน
  useEffect(() => {
    if (!query) return
    setLoading(true)
    setResult(null)
    const captured = query

    const extract = (r) => ({
      prefix_group: r.data?.prefix_group || [],
      inner_group: r.data?.inner_group || [],
    })

    searchWords(captured)
      .then((r) => {
        const { prefix_group, inner_group } = extract(r)
        if (prefix_group.length + inner_group.length > 0) {
          setResult({ prefix_group, inner_group, found: true })
          return
        }
        // ไม่เจอคำเต็ม: fallback ค้นอักษรแรก (ถ้าเลือกหลายตัว)
        if (captured.length > 1) {
          return searchWords(captured[0])
            .then((r2) => {
              const fb = extract(r2)
              if (fb.prefix_group.length + fb.inner_group.length > 0) {
                setResult({ ...fb, found: true })
              } else {
                setResult({ prefix_group: [], inner_group: [], found: false })
                reportMissedSearchDirect(captured).catch(() => {})
              }
            })
            .catch(() => {})
        }
        setResult({ prefix_group: [], inner_group: [], found: false })
        reportMissedSearchDirect(captured).catch(() => {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [query])

  const handleSearch = useCallback(() => {
    // ใช้ ref เสมอ — กัน mobile race condition ที่ state อาจยัง stale
    const text = selTextRef.current
    if (!text) return
    selTextRef.current = ''
    setSelText('')
    setIconPos(null)
    setQuery(text)
    setOpen(true)
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
            style={{ maxHeight: '90vh' }}
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

                  {result.prefix_group.length > 0 && (
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

                  {result.inner_group.length > 0 && (
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
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
