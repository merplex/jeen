import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { adminGetWords, adminUpdateWord } from '../../services/api'

// ─── Lock threshold ───────────────────────────────────────────────────────────
// id <= ตัวนี้ = คำเก่าของเปรม (lock), id > ตัวนี้ = import ใหม่ (แก้ได้)
const LOCK_BELOW_ID = 27268

// ─── Field config ────────────────────────────────────────────────────────────
// placement: 'main' = คอลัมน์หลัก (thai_meaning), 'under_chinese' = ใต้คำจีน
const EDIT_FIELDS = [
  {
    key: 'thai_meaning',
    label: 'คำแปลไทย',
    placeholder: 'คำแปลไทย...',
    type: 'textarea',
    rows: 3,
    placement: 'main',
    canLock: true,
  },
  {
    key: 'category',
    label: 'หมวดหมู่',
    placeholder: 'หมวดหมู่...',
    type: 'input',
    placement: 'under_chinese',
    canLock: false,
  },
]

const HSK_LEVELS = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6']
const LS_KEY = 'massTranslation_v1'

function readLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? {} } catch { return {} }
}
function writeLS(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch { /* quota exceeded */ }
}

function isWordLocked(word, lockedIds) {
  return word.id <= LOCK_BELOW_ID || lockedIds.includes(word.id)
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function MassTranslation() {
  const [hskFilter, setHskFilter] = useState(() => readLS().hskFilter ?? 'all')
  const [searchQuery, setSearchQuery] = useState(() => readLS().searchQuery ?? '')
  const [viewFilter, setViewFilter] = useState(() => readLS().viewFilter ?? 'all') // 'all' | 'edited' | 'unedited'
  const [edits, setEdits] = useState(() => readLS().edits ?? {})
  const [lockedIds, setLockedIds] = useState(() => readLS().lockedIds ?? [])
  const [focusedId, setFocusedId] = useState(() => readLS().focusedId ?? null)

  const [words, setWords] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  const focusRowRef = useRef(null)

  useEffect(() => {
    writeLS({ hskFilter, searchQuery, viewFilter, edits, lockedIds, focusedId })
  }, [hskFilter, searchQuery, viewFilter, edits, lockedIds, focusedId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFetchError('')
    setSaveResult(null)
    adminGetWords(hskFilter === 'all' ? null : hskFilter)
      .then(res => { if (!cancelled) setWords(res.data) })
      .catch(e => { if (!cancelled) setFetchError(e.response?.data?.detail ?? 'โหลดไม่ได้') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [hskFilter])

  useEffect(() => {
    if (focusedId && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [words])

  const filteredWords = useMemo(() => {
    let list = words
    const q = searchQuery.trim()
    if (q) {
      list = list.filter(w =>
        w.chinese.includes(q) || w.pinyin?.toLowerCase().includes(q.toLowerCase())
      )
    }
    if (viewFilter === 'edited') {
      list = list.filter(w => edits[w.id])
    } else if (viewFilter === 'unedited') {
      // เฉพาะคำที่แก้ได้ (ไม่ lock) และยังไม่ได้กรอก
      list = list.filter(w => !isWordLocked(w, lockedIds) && !edits[w.id])
    }
    return list
  }, [words, searchQuery, viewFilter, edits, lockedIds])

  const pendingCount = useMemo(
    () => words.filter(w => edits[w.id]?.thai_meaning?.trim()).length,
    [edits, words]
  )

  const handleChange = useCallback((wordId, field, value) => {
    setEdits(prev => ({ ...prev, [wordId]: { ...prev[wordId], [field]: value } }))
  }, [])

  const clearWord = useCallback((wordId) => {
    setEdits(prev => { const next = { ...prev }; delete next[wordId]; return next })
  }, [])

  const handleAddDB = async () => {
    const toSave = words.filter(w => edits[w.id]?.thai_meaning?.trim())
    if (toSave.length === 0) return
    if (!window.confirm(`บันทึก ${toSave.length} คำ ลง DB?`)) return

    setSaving(true)
    setSaveResult(null)
    let done = 0
    const savedIds = []

    for (const word of toSave) {
      const payload = {}
      if (edits[word.id]?.thai_meaning) payload.thai_meaning = edits[word.id].thai_meaning
      if (edits[word.id]?.category) payload.category = edits[word.id].category
      try {
        await adminUpdateWord(word.id, payload)
        savedIds.push(word.id)
        done++
      } catch { /* continue */ }
    }

    setWords(prev => prev.map(w => {
      if (!savedIds.includes(w.id)) return w
      return {
        ...w,
        thai_meaning: edits[w.id]?.thai_meaning ?? w.thai_meaning,
        category: edits[w.id]?.category ?? w.category,
      }
    }))

    setLockedIds(prev => [...new Set([...prev, ...savedIds])])

    setEdits(prev => {
      const next = { ...prev }
      savedIds.forEach(id => {
        if (!next[id]) return
        const remaining = { ...next[id] }
        delete remaining.thai_meaning
        if (Object.keys(remaining).length === 0) delete next[id]
        else next[id] = remaining
      })
      return next
    })

    setSaving(false)
    setSaveResult({ done, total: toSave.length })
  }

  const mainFields = EDIT_FIELDS.filter(f => f.placement === 'main')
  const underChineseFields = EDIT_FIELDS.filter(f => f.placement === 'under_chinese')

  return (
    <div className="px-4 py-6">

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-xl p-4 mb-4 shadow-sm">
        {/* HSK toggle */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setHskFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              hskFilter === 'all' ? 'bg-chinese-red text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            ทั้งหมด HSK
          </button>
          {HSK_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => setHskFilter(level)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                hskFilter === level ? 'bg-chinese-red text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="ค้นหาด้วยอักษรจีนหรือพินอิน..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red mb-3"
        />

        {/* View filter toggle */}
        <div className="flex gap-1.5 mb-3">
          {[
            { val: 'all', label: 'ทั้งหมด' },
            { val: 'unedited', label: 'ยังไม่กรอก' },
            { val: 'edited', label: 'กรอกแล้ว' },
          ].map(opt => (
            <button
              key={opt.val}
              onClick={() => setViewFilter(opt.val)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                viewFilter === opt.val ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Stats + Add DB */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-gray-500">
            แสดง {filteredWords.length} คำ · กรอกใหม่ {pendingCount} คำ
          </span>
          {pendingCount > 0 && (
            <button
              onClick={handleAddDB}
              disabled={saving}
              className="text-xs px-4 py-1.5 bg-chinese-red text-white rounded-full disabled:opacity-50"
            >
              {saving ? 'กำลัง save...' : `Add DB (${pendingCount} คำ)`}
            </button>
          )}
        </div>

        {saveResult && (
          <div className="mt-2 text-xs text-green-600">
            ✓ บันทึกสำเร็จ {saveResult.done}/{saveResult.total} คำ
            {saveResult.done < saveResult.total && (
              <span className="text-red-500 ml-1">(พลาด {saveResult.total - saveResult.done} คำ)</span>
            )}
          </div>
        )}
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">กำลังโหลด...</div>
      ) : fetchError ? (
        <div className="text-center py-10 text-red-500 text-sm">{fetchError}</div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="grid px-2 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium gap-2"
            style={{ gridTemplateColumns: '22px 90px 1fr 18px' }}>
            <span>#</span>
            <span>คำศัพท์</span>
            <span>คำแปลไทย</span>
            <span />
          </div>

          {filteredWords.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">ไม่พบคำ</div>
          ) : (
            filteredWords.map((word, idx) => {
              const wordEdit = edits[word.id]
              const hasLocalEdit = !!wordEdit
              const locked = isWordLocked(word, lockedIds)
              const isFocused = focusedId === word.id

              return (
                <div
                  key={word.id}
                  ref={isFocused ? focusRowRef : null}
                  onClick={() => setFocusedId(word.id)}
                  className={`grid gap-2 px-2 py-2 border-b border-gray-50 transition-colors items-start ${
                    isFocused ? 'bg-blue-50' : hasLocalEdit ? 'bg-green-50' : ''
                  }`}
                  style={{ gridTemplateColumns: '22px 90px 1fr 18px' }}
                >
                  {/* Index */}
                  <span className="text-xs text-gray-400 pt-1 select-none">{idx + 1}</span>

                  {/* Chinese card + under_chinese fields */}
                  <div className="min-w-0">
                    <div className="text-base font-medium leading-tight">{word.chinese}</div>
                    <div className="text-xs text-gray-400 leading-tight mt-0.5">{word.pinyin}</div>
                    {word.hsk_level && (
                      <div className="text-xs text-red-400 leading-tight">{word.hsk_level}</div>
                    )}
                    {/* Fields under chinese (e.g. category) */}
                    {underChineseFields.map(field => {
                      const val = wordEdit?.[field.key] !== undefined
                        ? wordEdit[field.key]
                        : (word[field.key] ?? '')
                      return (
                        <input
                          key={field.key}
                          type="text"
                          value={val}
                          onChange={e => handleChange(word.id, field.key, e.target.value)}
                          onFocus={() => setFocusedId(word.id)}
                          placeholder={field.placeholder}
                          disabled={locked && field.canLock}
                          className="mt-1 w-full text-xs border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-chinese-red disabled:bg-gray-50 disabled:text-gray-300"
                        />
                      )
                    })}
                  </div>

                  {/* Main field (thai_meaning) */}
                  {mainFields.map(field => {
                    const val = wordEdit?.[field.key] !== undefined
                      ? wordEdit[field.key]
                      : (word[field.key] ?? '')

                    if (locked && field.canLock) {
                      return (
                        <div
                          key={field.key}
                          className="text-xs text-gray-400 px-1.5 py-1 leading-snug italic bg-gray-50 rounded"
                          title="lock — แก้ที่ word detail"
                        >
                          {word[field.key] || <span className="text-gray-300">—</span>}
                        </div>
                      )
                    }

                    return (
                      <textarea
                        key={field.key}
                        value={val}
                        onChange={e => handleChange(word.id, field.key, e.target.value)}
                        onFocus={() => setFocusedId(word.id)}
                        placeholder={field.placeholder}
                        rows={field.rows ?? 3}
                        className="text-xs border border-gray-200 rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-chinese-red w-full leading-snug"
                      />
                    )
                  })}

                  {/* Clear button */}
                  <div className="pt-1 flex items-start justify-center">
                    {hasLocalEdit && (
                      <button
                        onClick={e => { e.stopPropagation(); clearWord(word.id) }}
                        className="text-gray-300 hover:text-red-400 text-sm leading-none"
                        title="ยกเลิกการแก้ไขแถวนี้"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
