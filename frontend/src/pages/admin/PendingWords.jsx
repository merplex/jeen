import { useEffect, useState, useCallback } from 'react'
import { adminGetPending, adminApprove, adminReject, adminGenerateDailyWords } from '../../services/api'

const LIMIT = 50

const CATEGORIES = [
  'ทั่วไป', 'ชีวิตประจำวัน', 'อาหาร', 'สัตว์', 'สถานที่', 'ครอบครัว',
  'ร่างกาย', 'การงาน', 'การเดินทาง', 'กีฬา', 'แพทย์', 'วิศวกรรม',
  'เทคนิค', 'ธุรกิจ', 'กฎหมาย', 'สำนวน',
]

export default function PendingWords() {
  const [words, setWords] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [page, setPage] = useState(0)

  const [thaiInputs, setThaiInputs] = useState({})
  const [pinyinInputs, setPinyinInputs] = useState({})
  const [categoryInputs, setCategoryInputs] = useState({})
  const [busy, setBusy] = useState({})

  // generate panel
  const [genCount, setGenCount] = useState(100)
  const [genCategory, setGenCategory] = useState('')
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
      setPinyinInputs({})
      setCategoryInputs({})
    } catch (e) {
      setFetchError(e.response?.data?.detail || 'โหลดข้อมูลไม่ได้ — ลอง restart backend')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPage(page * LIMIT) }, [page, fetchPage])

  const getThai = (w) => thaiInputs[w.id] !== undefined ? thaiInputs[w.id] : (w.thai_meaning || '')
  const getPinyin = (w) => pinyinInputs[w.id] !== undefined ? pinyinInputs[w.id] : (w.pinyin || '')
  const getCat = (w) => categoryInputs[w.id] !== undefined ? categoryInputs[w.id] : (w.category || '')

  const approve = async (w, wordIndex) => {
    const thai = getThai(w)
    if (!thai.trim()) return
    setBusy((b) => ({ ...b, [w.id]: 'approving' }))
    try {
      await adminApprove(w.id, thai, getPinyin(w), getCat(w))
      setWords((ws) => ws.filter((x) => x.id !== w.id))
      setThaiInputs((t) => { const n = { ...t }; delete n[w.id]; return n })
      // focus คำถัดไปอัตโนมัติ
      setTimeout(() => {
        const inputs = document.querySelectorAll('[data-thai-input]')
        const target = inputs[wordIndex] || inputs[Math.max(0, wordIndex - 1)]
        if (target) target.focus()
      }, 50)
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
      const r = await adminGenerateDailyWords(genCount, genCategory || null)
      setGenMsg(`✓ สร้างคำใหม่ ${r.data.inserted} คำ (ขอ ${r.data.requested} คำ)`)
      await fetchPage(0)
      setPage(0)
    } catch (e) {
      setGenMsg('เกิดข้อผิดพลาด: ' + (e.response?.data?.detail || e.message))
    }
    setGenerating(false)
  }

  const approveAllFilled = async () => {
    const filled = words.filter((w) => getThai(w).trim())
    if (!filled.length) return
    if (!confirm(`Approve ${filled.length} คำที่มีความหมายไทยแล้ว?`)) return
    setBulkLoading(true)
    for (const w of filled) {
      try {
        await adminApprove(w.id, getThai(w), getPinyin(w), getCat(w))
        setWords((ws) => ws.filter((x) => x.id !== w.id))
      } catch (_) { /* skip failed */ }
    }
    setThaiInputs({})
    setBulkLoading(false)
  }

  const filledCount = words.filter((w) => getThai(w).trim()).length
  const allWords = [
    ...words.filter((w) => w.source === 'ai_daily'),
    ...words.filter((w) => w.source !== 'ai_daily'),
  ]

  return (
    <div className="px-4 py-4">

      {/* Generate Panel */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4 border border-orange-100">
        <div className="text-sm font-semibold text-gray-700 mb-3">🤖 สร้างคำวันนี้จาก AI</div>
        <div className="flex gap-2 mb-2">
          <select
            value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))}
            className="border rounded-lg px-2 py-2 text-sm bg-white"
            disabled={generating}
          >
            {[50, 100, 150, 200].map((n) => (
              <option key={n} value={n}>{n} คำ</option>
            ))}
          </select>
          <select
            value={genCategory}
            onChange={(e) => setGenCategory(e.target.value)}
            className="flex-1 border rounded-lg px-2 py-2 text-sm bg-white"
            disabled={generating}
          >
            <option value="">ทั่วไป / ชีวิตประจำวัน</option>
            <option value="แพทย์">แพทย์</option>
            <option value="วิศวกรรม">วิศวกรรม</option>
            <option value="เทคนิค">เทคนิค / IT</option>
            <option value="ธุรกิจ">ธุรกิจ</option>
            <option value="กฎหมาย">กฎหมาย</option>
            <option value="กีฬา">กีฬา</option>
            <option value="สัตว์">สัตว์</option>
            <option value="อาหาร">อาหาร</option>
            <option value="สำนวน">สำนวน / คำอุปมา</option>
          </select>
        </div>
        <button
          onClick={generateDaily}
          disabled={generating}
          className="w-full bg-orange-500 text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {generating ? '⏳ กำลังสร้าง...' : '✨ สร้างคำศัพท์'}
        </button>
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

      {/* datalist สำหรับ category (ใช้ร่วมกันทุก card) */}
      <datalist id="word-categories">
        {CATEGORIES.map((c) => <option key={c} value={c} />)}
      </datalist>

      <div className="space-y-2">
        {allWords.map((w, index) => {
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
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Chinese */}
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="font-chinese text-xl text-chinese-red">{w.chinese}</span>
                    {w.source === 'ai_daily' && <span className="text-xs text-orange-300">🤖</span>}
                  </div>

                  {/* Thai input — หลักที่ต้องกรอก */}
                  <input
                    type="text"
                    data-thai-input="true"
                    value={thai}
                    onChange={(e) => setThaiInputs((t) => ({ ...t, [w.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canApprove) approve(w, index) }}
                    placeholder="ความหมายภาษาไทย..."
                    className={`w-full text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:border-chinese-red transition-colors ${
                      thai.trim() ? 'border-green-300 bg-green-50' : 'border-gray-200'
                    }`}
                    disabled={isBusy}
                  />

                  {/* Pinyin + Category — แก้ได้ */}
                  <div className="flex gap-1.5 mt-1.5">
                    <input
                      type="text"
                      value={getPinyin(w)}
                      onChange={(e) => setPinyinInputs((p) => ({ ...p, [w.id]: e.target.value }))}
                      placeholder="พินอิน..."
                      className="w-5/12 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-300 text-gray-500 bg-gray-50"
                      disabled={isBusy}
                    />
                    <input
                      type="text"
                      list="word-categories"
                      value={getCat(w)}
                      onChange={(e) => setCategoryInputs((c) => ({ ...c, [w.id]: e.target.value }))}
                      placeholder="หมวด..."
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-blue-300 text-gray-500 bg-gray-50"
                      disabled={isBusy}
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => approve(w, index)}
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
