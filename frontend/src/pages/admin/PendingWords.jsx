import { useEffect, useState, useCallback } from 'react'
import { adminGetPending, adminApprove, adminReject, adminGenerateDailyWords } from '../../services/api'

const LIMIT = 50

export default function PendingWords() {
  const [words, setWords] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [page, setPage] = useState(0)

  // thai_meaning ที่พิมพ์ใหม่ per word: { id: string }
  const [thaiInputs, setThaiInputs] = useState({})

  // สถานะ loading per word: { id: 'approving'|'rejecting' }
  const [busy, setBusy] = useState({})

  // generate daily words
  const [genCount, setGenCount] = useState(100)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')

  // bulk approve
  const [bulkLoading, setBulkLoading] = useState(false)

  const fetchPage = useCallback(async (skip) => {
    setLoading(true)
    setFetchError('')
    try {
      const r = await adminGetPending(skip, LIMIT)
      setWords(r.data)
      setThaiInputs({})
    } catch (e) {
      setFetchError(e.response?.data?.detail || 'โหลดข้อมูลไม่ได้ — ลองรัน alembic upgrade head หรือ restart backend')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPage(page * LIMIT) }, [page, fetchPage])

  // ค่า thai ที่จะใช้ตอน approve (input > DB)
  const getThai = (w) => thaiInputs[w.id] !== undefined ? thaiInputs[w.id] : (w.thai_meaning || '')

  const approve = async (w) => {
    const thai = getThai(w)
    if (!thai.trim()) return
    setBusy((b) => ({ ...b, [w.id]: 'approving' }))
    try {
      await adminApprove(w.id, thai)
      setWords((ws) => ws.filter((x) => x.id !== w.id))
      setThaiInputs((t) => { const n = { ...t }; delete n[w.id]; return n })
    } catch (e) {
      alert(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
    }
    setBusy((b) => { const n = { ...b }; delete n[w.id]; return n })
  }

  const reject = async (id) => {
    if (!confirm('ลบคำนี้ออกจาก pending?')) return
    setBusy((b) => ({ ...b, [id]: 'rejecting' }))
    await adminReject(id)
    setWords((ws) => ws.filter((x) => x.id !== id))
    setBusy((b) => { const n = { ...b }; delete n[id]; return n })
  }

  const generateDaily = async () => {
    setGenerating(true)
    setGenMsg('')
    try {
      const r = await adminGenerateDailyWords(genCount)
      setGenMsg(`✓ สร้างคำใหม่ ${r.data.inserted} คำ (ขอ ${r.data.requested} คำ)`)
      await fetchPage(0)
      setPage(0)
    } catch (e) {
      setGenMsg('เกิดข้อผิดพลาด: ' + (e.response?.data?.detail || e.message))
    }
    setGenerating(false)
  }

  // Approve all words ที่มี thai (ทั้งจาก DB และที่พิมพ์ไว้)
  const approveAllFilled = async () => {
    const filled = words.filter((w) => getThai(w).trim())
    if (!filled.length) return
    if (!confirm(`Approve ${filled.length} คำที่มีความหมายไทยแล้ว?`)) return
    setBulkLoading(true)
    for (const w of filled) {
      try {
        await adminApprove(w.id, getThai(w))
        setWords((ws) => ws.filter((x) => x.id !== w.id))
      } catch (_) { /* skip failed */ }
    }
    setThaiInputs({})
    setBulkLoading(false)
  }

  const filledCount = words.filter((w) => getThai(w).trim()).length
  const aiWords = words.filter((w) => w.source === 'ai_daily')
  const otherWords = words.filter((w) => w.source !== 'ai_daily')

  return (
    <div className="px-4 py-4">

      {/* Generate Daily Words Panel */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4 border border-orange-100">
        <div className="text-sm font-semibold text-gray-700 mb-3">🤖 สร้างคำวันนี้จาก AI</div>
        <div className="flex gap-2 items-center">
          <select
            value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm bg-white"
            disabled={generating}
          >
            {[50, 100, 150, 200].map((n) => (
              <option key={n} value={n}>{n} คำ</option>
            ))}
          </select>
          <button
            onClick={generateDaily}
            disabled={generating}
            className="flex-1 bg-orange-500 text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {generating ? '⏳ กำลังสร้าง...' : '✨ สร้างคำศัพท์'}
          </button>
        </div>
        {genMsg && (
          <p className={`text-xs mt-2 ${genMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
            {genMsg}
          </p>
        )}
      </div>

      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-sm text-red-600">
          ⚠️ {fetchError}
        </div>
      )}

      {/* Stats + Bulk Approve */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {loading ? 'กำลังโหลด...' : `${words.length} รายการ · แปลแล้ว ${filledCount} คำ`}
        </p>
        {filledCount > 0 && (
          <button
            onClick={approveAllFilled}
            disabled={bulkLoading}
            className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
          >
            {bulkLoading ? '⏳...' : `✓ Approve ทั้งหมด (${filledCount})`}
          </button>
        )}
      </div>

      {/* AI-generated words (ยังไม่มี thai) แสดงก่อน */}
      {aiWords.length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-orange-500 font-medium mb-2 px-1">
            🤖 AI แนะนำ — ต้องแปลภาษาไทย ({aiWords.length} คำ)
          </div>
        </div>
      )}

      <div className="space-y-2">
        {[...aiWords, ...otherWords].map((w) => {
          const thai = getThai(w)
          const isBusy = !!busy[w.id]
          const canApprove = thai.trim().length > 0

          return (
            <div
              key={w.id}
              className={`bg-white rounded-xl p-3 shadow-sm border-l-4 ${
                w.source === 'ai_daily' ? 'border-orange-300' : 'border-gray-100'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Word info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-chinese text-xl text-chinese-red">{w.chinese}</span>
                    <span className="text-sm text-gray-400">{w.pinyin}</span>
                  </div>
                  {/* Thai input */}
                  <input
                    type="text"
                    value={thai}
                    onChange={(e) => setThaiInputs((t) => ({ ...t, [w.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canApprove) approve(w) }}
                    placeholder="ใส่ความหมายภาษาไทย..."
                    className={`mt-1.5 w-full text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:border-chinese-red transition-colors ${
                      thai.trim() ? 'border-green-300 bg-green-50' : 'border-gray-200'
                    }`}
                    disabled={isBusy}
                  />
                  {w.source && (
                    <span className="text-xs text-gray-300 mt-1 block">
                      {w.source === 'ai_daily' ? '🤖 AI' : w.source}
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => approve(w)}
                    disabled={!canApprove || isBusy}
                    className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {busy[w.id] === 'approving' ? '...' : '✓'}
                  </button>
                  <button
                    onClick={() => reject(w.id)}
                    disabled={isBusy}
                    className="bg-red-100 text-red-500 px-3 py-1.5 rounded-lg text-sm disabled:opacity-30"
                  >
                    {busy[w.id] === 'rejecting' ? '...' : '✗'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {!loading && words.length === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">
          ไม่มีคำที่รอ Approve<br />
          <span className="text-xs">กด "สร้างคำวันนี้" เพื่อให้ AI แนะนำคำศัพท์</span>
        </div>
      )}

      {/* Pagination */}
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="flex-1 py-2 border rounded-lg disabled:opacity-40 text-sm"
        >
          ← หน้าก่อน
        </button>
        <span className="flex items-center text-sm text-gray-400 px-2">
          หน้า {page + 1}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={words.length < LIMIT}
          className="flex-1 py-2 border rounded-lg disabled:opacity-40 text-sm"
        >
          หน้าต่อไป →
        </button>
      </div>
    </div>
  )
}
