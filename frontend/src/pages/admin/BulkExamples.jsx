import { useEffect, useState, useRef } from 'react'
import {
  adminExamplesStats, adminWipeAllExamples, adminBulkGenerateExamples, adminBulkQueueExamples,
  adminEnglishStats, adminBulkGenerateEnglish, adminFixLongEnglish,
  adminRegenExamplesByCategory, adminBulkRegenShortExamples,
  adminSingleEnglishStats, adminBulkRegenSingleEnglish,
  adminGetSettings, adminUpdateSettings, adminDeleteImageCache, adminDeleteNullImageCache, adminDeleteAllImageCache,
  adminHskEnglishStats, adminStartHskEnglishQueue, adminStopHskEnglishQueue,
  adminCategoryWordCounts, adminRegenEnglishByCategory,
  adminRelatedStats, adminRegenRelatedByCategory,
} from '../../services/api'
import { CATEGORIES } from '../../utils/categories'
import CategoryImageConfig from './CategoryImageConfig'

const SINGLE_ENG_CATEGORIES = ['ทั้งหมด', ...CATEGORIES, 'ไม่มีหมวด']
const TABS = ['ตัวอย่างประโยค', 'แปลอังกฤษ', 'คำเกี่ยวข้อง', 'รูปประกอบ']

export default function BulkExamples() {
  const [activeTab, setActiveTab] = useState('ตัวอย่างประโยค')
  const [exStats, setExStats] = useState(null)
  const [enStats, setEnStats] = useState(null)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const [queueStatus, setQueueStatus] = useState(null)
  const stopRef = useRef(false)
  const [categoryWordCounts, setCategoryWordCounts] = useState(null)
  const [regenCat, setRegenCat] = useState('')
  const [regenLimit, setRegenLimit] = useState(20)
  const [engRegenCat, setEngRegenCat] = useState('')
  const [engRegenLimit, setEngRegenLimit] = useState(100)
  const [singleEngCat, setSingleEngCat] = useState('ทั้งหมด')
  const [singleEngCount, setSingleEngCount] = useState(null)
  const [hskEngTotal, setHskEngTotal] = useState(null)
  const [hskEngQueue, setHskEngQueue] = useState(null)
  const [imageCategories, setImageCategories] = useState([])
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [relatedStats, setRelatedStats] = useState(null)
  const [relatedRegenCat, setRelatedRegenCat] = useState('')
  const [relatedRegenLimit, setRelatedRegenLimit] = useState(50)

  const loadStats = async () => {
    const [ex, en] = await Promise.all([adminExamplesStats(), adminEnglishStats()])
    setExStats(ex.data)
    setEnStats(en.data)
  }

  const loadRelatedStats = async () => {
    adminRelatedStats().then((r) => setRelatedStats(r.data)).catch(() => {})
  }

  const runRegenRelated = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    const isHsk = /^hsk\d$/.test(relatedRegenCat)
    addLog(`เริ่ม regen คำเกี่ยวข้อง "${relatedRegenCat}"...`)
    let total = 0, offset = 0, retries = 0
    while (!stopRef.current) {
      try {
        const r = await adminRegenRelatedByCategory(
          isHsk ? null : relatedRegenCat, isHsk ? relatedRegenCat : null, relatedRegenLimit, offset
        )
        const { done, errors, total_in_filter, next_offset, last_error } = r.data
        total += done; retries = 0
        addLog(`✓ สร้าง ${done} คำ | error ${errors}${last_error ? ` (${last_error})` : ''} | ${next_offset}/${total_in_filter} คำ`)
        offset = next_offset
        if (done === 0 && errors === 0) break
        if (next_offset >= total_in_filter) break
      } catch (e) {
        retries++
        if (retries <= 3) { addLog(`✗ Network error — retry ${retries}/3...`); await new Promise((res) => setTimeout(res, 2000 * retries)) }
        else { addLog(`✗ หยุด — network error เกิน 3 ครั้ง`); break }
      }
    }
    addLog(`เสร็จ — regen รวม ${total} คำ`)
    setRunning(false); loadRelatedStats()
  }

  const loadSingleEngCount = async (cat) => {
    const apiCat = cat === 'ทั้งหมด' ? null : cat === 'ไม่มีหมวด' ? '__none__' : cat
    const r = await adminSingleEnglishStats(apiCat)
    setSingleEngCount(r.data.count)
  }

  const loadSettings = async () => {
    try {
      const r = await adminGetSettings()
      setImageCategories(r.data.image_categories || [])
    } catch (e) {}
  }

  useEffect(() => {
    loadStats()
    loadSettings()
    loadRelatedStats()
    adminHskEnglishStats().then((r) => { setHskEngTotal(r.data.total); setHskEngQueue(r.data.queue) }).catch(() => {})
    adminCategoryWordCounts().then((r) => {
      setCategoryWordCounts(r.data)
      const allOptions = [...r.data.categories.map(c => c.name), ...r.data.hsk_levels.map(h => h.name)]
      if (allOptions.length > 0) {
        setRegenCat(allOptions[0])
        setEngRegenCat(allOptions[0])
      }
      const RELATED_CATS = ['ทั่วไป', 'ชีวิตประจำวัน', 'ธุรกิจ', 'กฏหมาย', 'สำนวน']
      const firstRelated = r.data.categories.find(c => RELATED_CATS.includes(c.name))
      if (firstRelated) setRelatedRegenCat(firstRelated.name)
    }).catch(() => {})
  }, [])
  useEffect(() => { loadSingleEngCount(singleEngCat) }, [singleEngCat])

  const addLog = (msg) => setLog((prev) => [...prev, msg])

  const runBulkEnglish = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    addLog('เริ่มสร้างความหมายอังกฤษ...')
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkGenerateEnglish(500)
        const { done, errors, remaining } = r.data
        total += done
        addLog(`✓ อัปเดต ${done} คำ | error ${errors} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || (done === 0 && errors > 0)) break
      } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`); break }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false); loadStats()
  }

  const runBulkExamples = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    addLog('เริ่มสร้างตัวอย่างประโยค...')
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkGenerateExamples(30)
        const { done, errors, remaining, last_error } = r.data
        total += done
        const errNote = last_error ? ` (${last_error})` : ''
        addLog(`✓ สร้าง ${done} คำ | error ${errors}${errNote} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || (done === 0 && errors > 0)) break
      } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`); break }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false); loadStats()
  }

  const stopAll = () => { stopRef.current = true; addLog('หยุดหลังรอบนี้เสร็จ...') }

  const refreshHskQueue = async () => {
    try {
      const r = await adminHskEnglishStats()
      setHskEngTotal(r.data.total); setHskEngQueue(r.data.queue)
    } catch (e) {}
  }

  const startHskQueue = async () => {
    try {
      const r = await adminStartHskEnglishQueue()
      setHskEngQueue(r.data.queue)
      addLog(r.data.started ? '📥 เริ่ม Background Queue HSK English แล้ว — ปิดหน้าจอได้เลย' : '⚠️ Queue กำลังทำงานอยู่แล้ว')
    } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`) }
  }

  const stopHskQueue = async () => {
    try {
      const r = await adminStopHskEnglishQueue()
      setHskEngQueue(r.data.queue)
      addLog('⏹ สั่งหยุด HSK English Queue แล้ว')
    } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`) }
  }

  const runRegenSingleEnglish = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    const apiCat = singleEngCat === 'ทั้งหมด' ? null : singleEngCat === 'ไม่มีหมวด' ? '__none__' : singleEngCat
    addLog(`เริ่ม regen English คำเดียว${singleEngCat !== 'ทั้งหมด' ? ` หมวด "${singleEngCat}"` : ''}...`)
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkRegenSingleEnglish(500, apiCat)
        const { done, skipped, errors, remaining } = r.data
        total += done
        addLog(`✓ อัปเดต ${done} คำ | ข้าม ${skipped} (ยังคำเดียว) | error ${errors} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || done === 0) break
      } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`); break }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false); loadSingleEngCount(singleEngCat)
  }

  const runRegenShort = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    addLog('เริ่ม regen ตัวอย่างสั้น (< 10 ตัวอักษร)...')
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkRegenShortExamples(30, 10)
        const { done, errors, remaining, last_error } = r.data
        total += done
        addLog(`✓ regen ${done} คำ | error ${errors}${last_error ? ` (${last_error})` : ''} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || (done === 0 && errors > 0)) break
      } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`); break }
    }
    addLog(`เสร็จ — regen รวม ${total} คำ`)
    setRunning(false); loadStats()
  }

  const _isHskLevel = (val) => /^hsk\d$/.test(val)

  const runRegenByCategory = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    addLog(`เริ่ม regen ตัวอย่าง "${regenCat}"...`)
    const isHsk = _isHskLevel(regenCat)
    let total = 0, offset = 0, retries = 0
    while (!stopRef.current) {
      try {
        const r = await adminRegenExamplesByCategory(
          isHsk ? null : regenCat, regenLimit, offset, isHsk ? regenCat : null
        )
        const { done, errors, total_in_category, next_offset, last_error } = r.data
        total += done; retries = 0
        addLog(`✓ regen ${done} คำ | error ${errors}${last_error ? ` (${last_error})` : ''} | ${next_offset}/${total_in_category} คำ`)
        offset = next_offset
        if (done === 0 && errors === 0) break
        if (next_offset >= total_in_category) break
      } catch (e) {
        retries++
        if (retries <= 3) { addLog(`✗ Network error — retry ${retries}/3...`); await new Promise((res) => setTimeout(res, 2000 * retries)) }
        else { addLog(`✗ หยุด — network error เกิน 3 ครั้ง (offset: ${offset})`); break }
      }
    }
    addLog(`เสร็จ — regen รวม ${total} คำ`)
    setRunning(false); loadStats()
  }

  const runRegenEnglishByCategory = async () => {
    if (running) return
    setRunning(true); stopRef.current = false; setLog([])
    addLog(`เริ่ม regen English "${engRegenCat}"...`)
    const isHsk = _isHskLevel(engRegenCat)
    let total = 0, offset = 0, retries = 0
    while (!stopRef.current) {
      try {
        const r = await adminRegenEnglishByCategory(
          isHsk ? null : engRegenCat, isHsk ? engRegenCat : null, engRegenLimit, offset
        )
        const { done, errors, total_in_filter, next_offset } = r.data
        total += done; retries = 0
        addLog(`✓ อัปเดต ${done} คำ | error ${errors} | ${next_offset}/${total_in_filter} คำ`)
        offset = next_offset
        if (next_offset >= total_in_filter || (done === 0 && errors === 0)) break
      } catch (e) {
        retries++
        if (retries <= 3) { addLog(`✗ Network error — retry ${retries}/3...`); await new Promise((res) => setTimeout(res, 2000 * retries)) }
        else { addLog(`✗ หยุด — network error เกิน 3 ครั้ง (offset: ${offset})`); break }
      }
    }
    addLog(`เสร็จ — regen English รวม ${total} คำ`)
    setRunning(false); loadStats()
  }

  const wipeAll = async () => {
    if (!window.confirm('ลบ examples ทั้งหมดเลยไหม?')) return
    const r = await adminWipeAllExamples()
    addLog(`🗑️ ลบแล้ว ${r.data.deleted} examples`)
    loadStats()
  }

  const toggleImageCategory = (cat) => {
    setImageCategories((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat])
  }

  const saveImageSettings = async () => {
    setSettingsSaving(true)
    try { await adminUpdateSettings({ image_categories: imageCategories }) }
    finally { setSettingsSaving(false) }
  }

  const pctEx = exStats ? Math.round((exStats.with_examples / (exStats.total_verified || 1)) * 100) : 0
  const pctEn = enStats ? Math.round((enStats.with_english / (enStats.total_verified || 1)) * 100) : 0

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-2 px-4 pt-4 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeTab === tab
                ? 'bg-chinese-red text-white border-chinese-red'
                : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="px-4 pb-6 space-y-3">

        {/* ── ตัวอย่างประโยค ── */}
        {activeTab === 'ตัวอย่างประโยค' && (
          <>
            {exStats ? (
              <>
                <div className="text-xs text-gray-500 pt-2">
                  {exStats.with_examples} / {exStats.total_verified} คำ
                  {exStats.with_short_examples > 0 && <span className="ml-2 text-amber-500">⚠️ สั้น {exStats.with_short_examples}</span>}
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pctEx}%` }} />
                </div>
                <button
                  onClick={async () => {
                    try {
                      const r = await adminBulkQueueExamples()
                      const { queued, queue_size } = r.data
                      setQueueStatus({ queued, queue_size })
                      addLog(`📥 ส่งเข้า queue ${queued} คำ — ปิดหน้าจอได้เลย`)
                      loadStats()
                    } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`) }
                  }}
                  disabled={exStats.without_examples === 0}
                  className="w-full bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >
                  📥 ส่งทั้งหมดเข้า Background Queue ({exStats.without_examples} คำ)
                </button>
                {queueStatus && (
                  <p className="text-xs text-gray-400 text-center">Queue: {queueStatus.queue_size} คำรอประมวลผล</p>
                )}
                <div className="flex gap-2">
                  {!running ? (
                    <button
                      onClick={runBulkExamples}
                      disabled={exStats.without_examples === 0}
                      className="flex-1 border border-gray-200 text-gray-500 rounded-lg py-2 text-sm disabled:opacity-40"
                    >
                      ✨ สร้างแบบ sync (ต้องเปิดหน้าจอไว้)
                    </button>
                  ) : (
                    <button onClick={stopAll} className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">⏹ หยุด</button>
                  )}
                  <button onClick={loadStats} disabled={running} className="px-3 border border-gray-200 rounded-lg text-sm text-gray-500 disabled:opacity-40">🔄</button>
                </div>
                {exStats.with_short_examples > 0 && (
                  <button onClick={runRegenShort} disabled={running}
                    className="w-full bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                  >
                    🔧 Regen ตัวอย่างสั้นเกิน ({exStats.with_short_examples} คำ, &lt;10 ตัวอักษร)
                  </button>
                )}
                {/* Regen ตามหมวด */}
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-400 mb-2">Regen ตัวอย่างตามหมวด (ลบ+gen ใหม่)</p>
                  <p className="text-xs text-gray-400 mb-3">ใช้ logic ใหม่ — คำแพทย์/กฎหมาย/สำนวนที่ไม่ได้ใช้พูดจะได้ formal_0+formal_1 แทน conv</p>
                  <div className="flex gap-2 mb-3">
                    <select value={regenCat} onChange={(e) => setRegenCat(e.target.value)} disabled={running}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      {categoryWordCounts ? (
                        <>
                          {categoryWordCounts.categories.map((c) => (
                            <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                          ))}
                          {categoryWordCounts.hsk_levels.map((h) => (
                            <option key={h.name} value={h.name}>{h.name} ({h.count})</option>
                          ))}
                        </>
                      ) : (
                        <option value="">กำลังโหลด...</option>
                      )}
                    </select>
                    <select value={regenLimit} onChange={(e) => setRegenLimit(Number(e.target.value))} disabled={running}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      {[10, 20, 30, 50].map((n) => <option key={n} value={n}>{n} คำ/รอบ</option>)}
                    </select>
                  </div>
                  {!running ? (
                    <button onClick={runRegenByCategory} disabled={running || !regenCat}
                      className="w-full bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                    >
                      🔁 Regen ตัวอย่าง "{regenCat}"
                    </button>
                  ) : (
                    <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">⏹ หยุด</button>
                  )}
                </div>
                <button onClick={wipeAll} disabled={running}
                  className="w-full border border-red-200 text-red-500 rounded-lg py-2 text-sm disabled:opacity-40"
                >
                  🗑️ ลบตัวอย่างทั้งหมด (reset)
                </button>
              </>
            ) : <p className="text-xs text-gray-400 pt-3">กำลังโหลด...</p>}
          </>
        )}

        {/* ── แปลอังกฤษ ── */}
        {activeTab === 'แปลอังกฤษ' && (
          <>
            {enStats ? (
              <>
                <div className="text-xs text-gray-500 pt-2">{enStats.with_english} / {enStats.total_verified} คำ</div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pctEn}%` }} />
                </div>
                <button onClick={runBulkEnglish} disabled={running || enStats.without_english === 0}
                  className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >
                  {running ? '⏳ กำลังทำงาน...' : `🌐 สร้างความหมายอังกฤษ (${enStats.without_english} คำที่เหลือ)`}
                </button>
                <button
                  onClick={async () => {
                    addLog('ตรวจหาและแก้ไข english_meaning ที่ยาวเกิน...')
                    try {
                      const r = await adminFixLongEnglish(100)
                      const { found, fixed, failed } = r.data
                      addLog(`🔧 พบ ${found} คำ | แก้ไข ${fixed} | ล้มเหลว ${failed}`)
                    } catch (e) { addLog(`✗ ${e.response?.data?.detail || e.message}`) }
                  }}
                  disabled={running}
                  className="w-full border border-blue-200 text-blue-600 rounded-lg py-2 text-sm disabled:opacity-40"
                >
                  🔧 แก้ไข English ที่ยาวเกิน (Gemini thinking)
                </button>
              </>
            ) : <p className="text-xs text-gray-400 pt-3">กำลังโหลด...</p>}

            {/* Regen HSK English */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500 font-medium mb-1">Regen English คำ HSK ทั้งหมด {hskEngTotal !== null && <span className="text-gray-400">({hskEngTotal} คำ)</span>}</p>
              <p className="text-xs text-gray-400 mb-3">overwrite english_meaning ของคำ HSK ทุกคำ — ทำงาน background ปิดหน้าจอได้เลย</p>
              {hskEngQueue && (
                <div className="text-xs text-gray-500 mb-3">
                  {hskEngQueue.running
                    ? <span className="text-green-600 animate-pulse">● กำลังทำงาน — {hskEngQueue.done}/{hskEngQueue.total} คำ (error {hskEngQueue.errors})</span>
                    : <span>หยุดอยู่ — ทำไปแล้ว {hskEngQueue.done} คำ</span>}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={startHskQueue} disabled={hskEngQueue?.running}
                  className="flex-1 bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >📥 เริ่ม Background Queue</button>
                <button onClick={stopHskQueue} disabled={!hskEngQueue?.running}
                  className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >⏹ หยุด</button>
                <button onClick={refreshHskQueue} className="px-3 border border-gray-200 rounded-lg text-sm text-gray-500">🔄</button>
              </div>
            </div>

            {/* Regen English ตามหมวด */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500 font-medium mb-1">Regen English ตามหมวด (overwrite ทุกคำ)</p>
              <p className="text-xs text-gray-400 mb-3">เขียนทับ english_meaning ของทุกคำในหมวด/ระดับ HSK ที่เลือก</p>
              <div className="flex gap-2 mb-3">
                <select value={engRegenCat} onChange={(e) => setEngRegenCat(e.target.value)} disabled={running}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {categoryWordCounts ? (
                    <>
                      {categoryWordCounts.categories.map((c) => (
                        <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                      ))}
                      {categoryWordCounts.hsk_levels.map((h) => (
                        <option key={h.name} value={h.name}>{h.name} ({h.count})</option>
                      ))}
                    </>
                  ) : (
                    <option value="">กำลังโหลด...</option>
                  )}
                </select>
                <select value={engRegenLimit} onChange={(e) => setEngRegenLimit(Number(e.target.value))} disabled={running}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {[50, 100, 200].map((n) => <option key={n} value={n}>{n} คำ/รอบ</option>)}
                </select>
              </div>
              {!running ? (
                <button onClick={runRegenEnglishByCategory} disabled={running || !engRegenCat}
                  className="w-full bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >
                  🔁 Regen English "{engRegenCat}"
                </button>
              ) : (
                <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">⏹ หยุด</button>
              )}
            </div>

            {/* Regen single English */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500 font-medium mb-1">Regen English คำเดียว → หลายความหมาย</p>
              <p className="text-xs text-gray-400 mb-3">คำที่มี english_meaning แค่คำเดียว (ไม่มี comma) — ขอให้ Gemini เพิ่มความหมายให้ครอบคลุม</p>
              <select value={singleEngCat} onChange={(e) => setSingleEngCat(e.target.value)} disabled={running}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
              >
                {SINGLE_ENG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="text-xs mb-3 min-h-[1.25rem]">
                {singleEngCount === null
                  ? <span className="text-gray-300">กำลังตรวจ...</span>
                  : singleEngCount === 0
                    ? <span className="text-green-500">✓ ไม่มีคำที่ต้องแก้ในหมวดนี้</span>
                    : <span className="text-amber-600">⚠️ มี <strong>{singleEngCount}</strong> คำในหมวดนี้ที่ยังแปลอังกฤษแค่คำเดียว</span>
                }
              </div>
              {!running ? (
                <button onClick={runRegenSingleEnglish} disabled={running || singleEngCount === 0}
                  className="w-full bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >🔁 Regen English คำเดียว</button>
              ) : (
                <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">⏹ หยุด</button>
              )}
            </div>
          </>
        )}

        {/* ── คำเกี่ยวข้อง ── */}
        {activeTab === 'คำเกี่ยวข้อง' && (
          <>
            {relatedStats ? (
              <>
                <div className="text-xs text-gray-500 pt-2">
                  {relatedStats.with_related} / {relatedStats.total_eligible} คำ (eligible: 2 หรือ 4+ อักษร)
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-purple-500 h-2 rounded-full transition-all"
                    style={{ width: `${Math.round((relatedStats.with_related / (relatedStats.total_eligible || 1)) * 100)}%` }}
                  />
                </div>
              </>
            ) : <p className="text-xs text-gray-400 pt-2">กำลังโหลด...</p>}

            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500 font-medium mb-1">Regen คำเกี่ยวข้อง ตามหมวด (overwrite)</p>
              <p className="text-xs text-gray-400 mb-3">เขียนทับ related_words ของทุกคำในหมวดที่เลือก (เฉพาะ ทั่วไป/ชีวิตประจำวัน/ธุรกิจ/กฏหมาย/สำนวน)</p>
              <div className="flex gap-2 mb-3">
                <select
                  value={relatedRegenCat}
                  onChange={(e) => setRelatedRegenCat(e.target.value)}
                  disabled={running}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {categoryWordCounts ? (
                    categoryWordCounts.categories
                      .filter((c) => ['ทั่วไป', 'ชีวิตประจำวัน', 'ธุรกิจ', 'กฏหมาย', 'สำนวน'].includes(c.name))
                      .map((c) => (
                        <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                      ))
                  ) : (
                    <option value="">กำลังโหลด...</option>
                  )}
                </select>
                <select
                  value={relatedRegenLimit}
                  onChange={(e) => setRelatedRegenLimit(Number(e.target.value))}
                  disabled={running}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {[50, 100, 200].map((n) => <option key={n} value={n}>{n} คำ/รอบ</option>)}
                </select>
              </div>
              {!running ? (
                <button
                  onClick={runRegenRelated}
                  disabled={running || !relatedRegenCat}
                  className="w-full bg-purple-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >
                  🔁 Regen คำเกี่ยวข้อง "{relatedRegenCat}"
                </button>
              ) : (
                <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">⏹ หยุด</button>
              )}
            </div>
          </>
        )}

        {/* ── รูปประกอบ ── */}
        {activeTab === 'รูปประกอบ' && (
          <>
            <p className="text-xs text-gray-400 pt-2 mb-3">
              หมวดที่เลือกจะแสดงรูปภาพประกอบในหน้าคำศัพท์ (ดึงจาก Wikipedia โดย AI)
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {CATEGORIES.map((cat) => (
                <div key={cat} className="flex items-center">
                  <button
                    onClick={() => toggleImageCategory(cat)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      imageCategories.includes(cat)
                        ? 'bg-chinese-red text-white border-chinese-red rounded-r-none border-r-0'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >{cat}</button>
                  {imageCategories.includes(cat) && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`ลบ cache รูปประกอบหมวด "${cat}" ทั้งหมด?\n\nครั้งถัดไปที่เปิดคำในหมวดนี้จะดึงรูปใหม่อัตโนมัติ`)) return
                        const r = await adminDeleteImageCache(cat)
                        addLog(`ลบ cache รูปหมวด "${cat}" แล้ว ${r.data.deleted} รายการ`)
                      }}
                      className="text-xs bg-chinese-red/80 text-white px-2 py-1.5 rounded-r-full border border-chinese-red border-l-0 font-medium"
                    >×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={saveImageSettings} disabled={settingsSaving}
              className="w-full bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            >
              {settingsSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
            </button>
            <button
              onClick={async () => {
                if (!window.confirm('ลบ cache entries ที่ไม่มีรูป (null) เพื่อให้ระบบ retry หารูปใหม่?')) return
                const r = await adminDeleteNullImageCache()
                addLog(`🔄 ลบ null cache แล้ว ${r.data.deleted} รายการ — จะ retry ครั้งหน้าที่เปิดหน้าคำศัพท์`)
              }}
              className="w-full border border-orange-200 text-orange-500 rounded-lg py-2 text-sm"
            >🔄 ลบ null cache (retry หารูป)</button>
            <button
              onClick={async () => {
                const excStr = imageCategories.length > 0 ? ` (ยกเว้นหมวด: ${imageCategories.join(', ')})` : ''
                if (!window.confirm(`ลบ cache รูปทั้งหมด${excStr}?`)) return
                const r = await adminDeleteAllImageCache(imageCategories)
                addLog(`🗑️ ลบ cache รูปทั้งหมดแล้ว ${r.data.deleted} รายการ${excStr}`)
              }}
              className="w-full border border-gray-200 text-gray-500 rounded-lg py-2 text-sm"
            >
              🗑️ ลบ cache รูปทั้งหมด {imageCategories.length > 0 && `(ยกเว้น ${imageCategories.length} หมวดที่เลือก)`}
            </button>
            <div className="border-t border-gray-100 mt-2 -mx-4">
              <CategoryImageConfig />
            </div>
          </>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-400 mb-2">Log</p>
            {log.map((l, i) => (
              <p key={i} className="text-xs text-green-400 font-mono">{l}</p>
            ))}
            {running && <p className="text-xs text-yellow-400 font-mono animate-pulse">กำลังทำงาน...</p>}
          </div>
        )}
      </div>
    </div>
  )
}
