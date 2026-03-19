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

const HSK_LEVELS = ['hsk1', 'hsk2', 'hsk3', 'hsk4', 'hsk5', 'hsk6', 'hsk7']
const LS_KEY = 'massTranslation_v1'

function readLS() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? {} } catch { return {} }
}
function writeLS(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch { /* quota exceeded */ }
}

function isWordLocked(word, lockedIds, allUnlocked) {
  if (allUnlocked) return false
  return word.id <= LOCK_BELOW_ID || lockedIds.includes(word.id)
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function MassTranslation() {
  const [hskFilter, setHskFilter] = useState(() => readLS().hskFilter ?? 'all')
  const [searchQuery, setSearchQuery] = useState(() => readLS().searchQuery ?? '')
  const [viewFilter, setViewFilter] = useState(() => readLS().viewFilter ?? 'all') // 'all' | 'edited' | 'unedited'
  const [edits, setEdits] = useState(() => readLS().edits ?? {})
  const [lockedIds, setLockedIds] = useState(() => readLS().lockedIds ?? [])
  const [allUnlocked, setAllUnlocked] = useState(false)
  const [focusedId, setFocusedId] = useState(() => readLS().focusedId ?? null)

  const [confirmingAddDB, setConfirmingAddDB] = useState(false)
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
      list = list.filter(w => !isWordLocked(w, lockedIds, allUnlocked) && !edits[w.id])
    }
    return list
  }, [words, searchQuery, viewFilter, edits, lockedIds])

  const hasPendingEdit = useCallback((w) => {
    const edit = edits[w.id]
    if (!edit) return false
    if (edit.thai_meaning?.trim()) return true
    if (edit.category !== undefined && edit.category !== (w.category ?? '')) return true
    return false
  }, [edits])

  const pendingCount = useMemo(
    () => words.filter(w => hasPendingEdit(w)).length,
    [words, hasPendingEdit]
  )

  const handleChange = useCallback((wordId, field, value) => {
    setEdits(prev => ({ ...prev, [wordId]: { ...prev[wordId], [field]: value } }))
  }, [])

  const handleAddDB = async () => {
    const toSave = words.filter(w => hasPendingEdit(w))
    if (toSave.length === 0) return
    setConfirmingAddDB(false)
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
        delete remaining.category
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
    <>
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

        {/* Stats */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-gray-500">
            แสดง {filteredWords.length} คำ · กรอกใหม่ {pendingCount} คำ
          </span>
          {saving && <span className="text-xs text-gray-500">กำลัง save...</span>}
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
            style={{ gridTemplateColumns: '22px 90px 1fr' }}>
            <span>#</span>
            <span>คำศัพท์</span>
            <span>คำแปลไทย</span>
          </div>

          {filteredWords.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">ไม่พบคำ</div>
          ) : (
            filteredWords.map((word, idx) => {
              const wordEdit = edits[word.id]
              const locked = isWordLocked(word, lockedIds)
              const hasLocalEdit = hasPendingEdit(word)
              const isFocused = focusedId === word.id

              return (
                <div
                  key={word.id}
                  ref={isFocused ? focusRowRef : null}
                  onClick={() => setFocusedId(word.id)}
                  className={`grid gap-2 px-2 py-2 border-b border-gray-50 transition-colors items-start ${
                    isFocused ? 'bg-blue-50' : hasLocalEdit ? 'bg-green-50' : locked ? 'bg-gray-50/60' : ''
                  }`}
                  style={{ gridTemplateColumns: '22px 90px 1fr' }}
                >
                  {/* Index */}
                  <span className="text-xs text-gray-400 pt-1 select-none">
                    {locked ? <span className="text-green-400">✓</span> : idx + 1}
                  </span>

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

                </div>
              )
            })
          )}
        </div>
      )}
    </div>

      {/* Floating lock/unlock buttons */}
      <div className="fixed top-4 left-4 z-50 flex flex-col gap-2">
        {!allUnlocked ? (
          <button
            onClick={() => setAllUnlocked(true)}
            className="px-4 py-3 bg-gray-700 text-white rounded-2xl shadow-xl text-sm font-medium"
          >
            ปลดล็อคทั้งหมด
          </button>
        ) : (
          <button
            onClick={() => { setAllUnlocked(false); setLockedIds([]) }}
            className="px-4 py-3 bg-gray-400 text-white rounded-2xl shadow-xl text-sm font-medium"
          >
            ล็อคทั้งหมด
          </button>
        )}
      </div>

      {/* Floating Add DB button */}
      {pendingCount > 0 && !saving && (
        <div className="fixed top-4 right-4 z-50">
          {confirmingAddDB ? (
            <div className="flex flex-col items-end gap-2">
              <div className="bg-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-2 border border-gray-200">
                <span className="text-xs text-gray-500">บันทึก {pendingCount} คำ?</span>
                <button onClick={handleAddDB} className="text-xs px-3 py-1.5 bg-chinese-red text-white rounded-full">
                  ยืนยัน
                </button>
                <button onClick={() => setConfirmingAddDB(false)} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-600 rounded-full">
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingAddDB(true)}
              className="px-5 py-3 bg-chinese-red text-white rounded-2xl shadow-xl text-sm font-medium"
            >
              Add DB ({pendingCount} คำ)
            </button>
          )}
        </div>
      )}
      {saving && (
        <div className="fixed top-4 right-4 z-50 bg-white rounded-2xl shadow-xl px-4 py-3 text-xs text-gray-500">
          กำลัง save...
        </div>
      )}
    </>
  )
}
