import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { adminGetWords, adminUpdateWord } from '../../services/api'

// ─── Lock threshold ───────────────────────────────────────────────────────────
// คำที่ id <= ตัวนี้ = คำเก่าของเปรม (ตรวจแล้ว) → lock
// คำที่ id > ตัวนี้ = import ใหม่ยังไม่ตรวจ → แก้ได้
// TODO: เปรมกรอก ID สุดท้ายก่อน import ตรงนี้
const LOCK_BELOW_ID = 27268

// ─── Field config ────────────────────────────────────────────────────────────
// ถ้าอยากเพิ่ม field ใหม่ในอนาคต แก้แค่นี้ที่เดียว
const EDIT_FIELDS = [
  {
    key: 'thai_meaning',
    label: 'คำแปลไทย',
    placeholder: 'คำแปลไทย...',
    type: 'textarea',
    rows: 2,
    canLock: true,   // lock ได้ตาม threshold + lockedIds
  },
  {
    key: 'category',
    label: 'หมวดหมู่',
    placeholder: 'เช่น อาหาร, สถานที่...',
    type: 'input',
    canLock: false,  // แก้ได้เสมอ
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

// ─── Helper: is this field locked for a given word? ──────────────────────────
// Lock ถ้า: คำเก่า (id <= threshold) หรือ เคยกด Add DB ไปแล้วในหน้านี้
function isFieldLocked(word, field, lockedIds) {
  if (!field.canLock) return false
  if (word.id <= LOCK_BELOW_ID) return true
  if (lockedIds.includes(word.id)) return true
  return false
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function MassTranslation() {
  // All persisted in localStorage — survives page close / network cut
  const [hskFilter, setHskFilter] = useState(() => readLS().hskFilter ?? 'all')
  const [searchQuery, setSearchQuery] = useState(() => readLS().searchQuery ?? '')
  const [showOnlyEdited, setShowOnlyEdited] = useState(() => readLS().showOnlyEdited ?? false)
  const [edits, setEdits] = useState(() => readLS().edits ?? {})
  const [lockedIds, setLockedIds] = useState(() => readLS().lockedIds ?? [])
  const [focusedId, setFocusedId] = useState(() => readLS().focusedId ?? null)

  const [words, setWords] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState(null)

  const focusRowRef = useRef(null)

  // ── Persist state on every change ──────────────────────────────────────────
  useEffect(() => {
    writeLS({ hskFilter, searchQuery, showOnlyEdited, edits, lockedIds, focusedId })
  }, [hskFilter, searchQuery, showOnlyEdited, edits, lockedIds, focusedId])

  // ── Fetch words ─────────────────────────────────────────────────────────────
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

  // ── Scroll to focused row after words load ───────────────────────────────────
  useEffect(() => {
    if (focusedId && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [words])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filteredWords = useMemo(() => {
    let list = words
    const q = searchQuery.trim()
    if (q) {
      list = list.filter(w =>
        w.chinese.includes(q) || w.pinyin?.toLowerCase().includes(q.toLowerCase())
      )
    }
    if (showOnlyEdited) {
      list = list.filter(w => edits[w.id])
    }
    return list
  }, [words, searchQuery, showOnlyEdited, edits])

  const pendingCount = useMemo(
    () => words.filter(w => edits[w.id]?.thai_meaning?.trim()).length,
    [edits, words]
  )

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleChange = useCallback((wordId, field, value) => {
    setEdits(prev => ({ ...prev, [wordId]: { ...prev[wordId], [field]: value } }))
  }, [])

  const clearWord = useCallback((wordId) => {
    setEdits(prev => { const next = { ...prev }; delete next[wordId]; return next })
  }, [])

  // ── Add DB ───────────────────────────────────────────────────────────────────
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
      } catch {
        // continue with next
      }
    }

    // Update local words array to reflect new DB values
    setWords(prev => prev.map(w => {
      if (!savedIds.includes(w.id)) return w
      return {
        ...w,
        thai_meaning: edits[w.id]?.thai_meaning ?? w.thai_meaning,
        category: edits[w.id]?.category ?? w.category,
      }
    }))

    // Add saved IDs to lockedIds → thai_meaning becomes read-only
    setLockedIds(prev => [...new Set([...prev, ...savedIds])])

    // Remove thai_meaning from edits (saved to DB), keep category edit if any
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

  // ── Render ────────────────────────────────────────────────────────────────────
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
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
        />

        {/* Stats + actions */}
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              แสดง {filteredWords.length} คำ · กรอกใหม่ {pendingCount} คำ
            </span>
            <button
              onClick={() => setShowOnlyEdited(v => !v)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                showOnlyEdited
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}
            >
              {showOnlyEdited ? '✓ เฉพาะที่กรอกแล้ว' : 'เฉพาะที่กรอกแล้ว'}
            </button>
          </div>

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

      {/* ── Legend ── */}
      <div className="flex gap-3 text-xs text-gray-400 mb-2 px-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-100 inline-block border border-green-200" />
          กรอกใหม่ (ยังไม่ add DB)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-gray-100 inline-block border border-gray-200" />
          lock (คำเก่า / add DB แล้ว)
        </span>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">กำลังโหลด...</div>
      ) : fetchError ? (
        <div className="text-center py-10 text-red-500 text-sm">{fetchError}</div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden shadow-sm">
          {/* Header */}
          <div
            className="px-2 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium grid gap-1"
            style={{ gridTemplateColumns: `22px 76px repeat(${EDIT_FIELDS.length}, 1fr) 18px` }}
          >
            <span>#</span>
            <span>คำศัพท์</span>
            {EDIT_FIELDS.map(f => <span key={f.key}>{f.label}</span>)}
            <span />
          </div>

          {filteredWords.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">ไม่พบคำ</div>
          ) : (
            filteredWords.map((word, idx) => {
              const wordEdit = edits[word.id]
              const hasLocalEdit = !!wordEdit
              const isFocused = focusedId === word.id

              return (
                <div
                  key={word.id}
                  ref={isFocused ? focusRowRef : null}
                  onClick={() => setFocusedId(word.id)}
                  className={`grid gap-1 px-2 py-1.5 border-b border-gray-50 transition-colors ${
                    isFocused ? 'bg-blue-50' : hasLocalEdit ? 'bg-green-50' : ''
                  }`}
                  style={{ gridTemplateColumns: `22px 76px repeat(${EDIT_FIELDS.length}, 1fr) 18px` }}
                >
                  {/* Index */}
                  <span className="text-xs text-gray-400 pt-2 select-none">{idx + 1}</span>

                  {/* Chinese card */}
                  <div className="pt-1 min-w-0">
                    <div className="text-sm font-medium leading-tight">{word.chinese}</div>
                    <div className="text-xs text-gray-400 truncate leading-tight">{word.pinyin}</div>
                    {word.hsk_level && (
                      <div className="text-xs text-red-400">{word.hsk_level}</div>
                    )}
                  </div>

                  {/* Edit fields */}
                  {EDIT_FIELDS.map(field => {
                    const locked = isFieldLocked(word, field, lockedIds)
                    const currentVal = wordEdit?.[field.key] !== undefined
                      ? wordEdit[field.key]
                      : (word[field.key] ?? '')

                    if (locked) {
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

                    if (field.type === 'textarea') {
                      return (
                        <textarea
                          key={field.key}
                          value={currentVal}
                          onChange={e => handleChange(word.id, field.key, e.target.value)}
                          onFocus={() => setFocusedId(word.id)}
                          placeholder={field.placeholder}
                          rows={field.rows ?? 2}
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-chinese-red w-full leading-snug"
                        />
                      )
                    }

                    return (
                      <input
                        key={field.key}
                        type="text"
                        value={currentVal}
                        onChange={e => handleChange(word.id, field.key, e.target.value)}
                        onFocus={() => setFocusedId(word.id)}
                        placeholder={field.placeholder}
                        className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-chinese-red w-full"
                      />
                    )
                  })}

                  {/* Clear row button */}
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
