import { useEffect, useState, useRef } from 'react'
import {
  adminExamplesStats, adminWipeAllExamples, adminBulkGenerateExamples,
  adminEnglishStats, adminBulkGenerateEnglish, adminFixLongEnglish,
  adminRegenExamplesByCategory, adminBulkRegenShortExamples,
  adminSingleEnglishStats, adminBulkRegenSingleEnglish,
  adminGetSettings, adminUpdateSettings, adminDeleteImageCache, adminDeleteAllImageCache,
} from '../../services/api'
import { CATEGORIES } from '../../utils/categories'

const REGEN_CATEGORIES = ['แพทย์', 'กฎหมาย', 'สำนวน', 'วิศวกรรม', 'เทคนิค']
const SINGLE_ENG_CATEGORIES = ['ทั้งหมด', ...CATEGORIES, 'ไม่มีหมวด']

function Section({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-600">{title}</span>
        <div className="flex items-center gap-2">
          {badge && <span className="text-xs text-gray-400">{badge}</span>}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-50">{children}</div>}
    </div>
  )
}

export default function BulkExamples() {
  const [exStats, setExStats] = useState(null)
  const [enStats, setEnStats] = useState(null)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const [regenCat, setRegenCat] = useState('แพทย์')
  const [regenLimit, setRegenLimit] = useState(20)
  const [singleEngCat, setSingleEngCat] = useState('ทั้งหมด')
  const [singleEngCount, setSingleEngCount] = useState(null)
  const [imageCategories, setImageCategories] = useState([])
  const [settingsSaving, setSettingsSaving] = useState(false)

  const loadStats = async () => {
    const [ex, en] = await Promise.all([adminExamplesStats(), adminEnglishStats()])
    setExStats(ex.data)
    setEnStats(en.data)
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
    } catch (e) {
      // ยังไม่มี settings
    }
  }

  useEffect(() => { loadStats(); loadSettings() }, [])
  useEffect(() => { loadSingleEngCount(singleEngCat) }, [singleEngCat])

  const addLog = (msg) => setLog((prev) => [...prev, msg])

  const runBulkEnglish = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
    addLog('เริ่มสร้างความหมายอังกฤษ...')
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkGenerateEnglish(50)
        const { done, errors, remaining } = r.data
        total += done
        addLog(`✓ อัปเดต ${done} คำ | error ${errors} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || (done === 0 && errors > 0)) break
      } catch (e) {
        addLog(`✗ ${e.response?.data?.detail || e.message}`)
        break
      }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false)
    loadStats()
  }

  const runBulkExamples = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
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
      } catch (e) {
        addLog(`✗ ${e.response?.data?.detail || e.message}`)
        break
      }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false)
    loadStats()
  }

  const stopAll = () => {
    stopRef.current = true
    addLog('หยุดหลังรอบนี้เสร็จ...')
  }

  const runRegenSingleEnglish = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
    const apiCat = singleEngCat === 'ทั้งหมด' ? null : singleEngCat === 'ไม่มีหมวด' ? '__none__' : singleEngCat
    addLog(`เริ่ม regen English คำเดียว${singleEngCat !== 'ทั้งหมด' ? ` หมวด "${singleEngCat}"` : ''}...`)
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkRegenSingleEnglish(50, apiCat)
        const { done, skipped, errors, remaining } = r.data
        total += done
        addLog(`✓ อัปเดต ${done} คำ | ข้าม ${skipped} (ยังคำเดียว) | error ${errors} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || done === 0) break
      } catch (e) {
        addLog(`✗ ${e.response?.data?.detail || e.message}`)
        break
      }
    }
    addLog(`เสร็จ — รวม ${total} คำ`)
    setRunning(false)
    loadSingleEngCount(singleEngCat)
  }

  const runRegenShort = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
    addLog('เริ่ม regen ตัวอย่างสั้น (< 10 ตัวอักษร)...')
    let total = 0
    while (!stopRef.current) {
      try {
        const r = await adminBulkRegenShortExamples(30, 10)
        const { done, errors, remaining, last_error } = r.data
        total += done
        const errNote = last_error ? ` (${last_error})` : ''
        addLog(`✓ regen ${done} คำ | error ${errors}${errNote} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || (done === 0 && errors > 0)) break
      } catch (e) {
        addLog(`✗ ${e.response?.data?.detail || e.message}`)
        break
      }
    }
    addLog(`เสร็จ — regen รวม ${total} คำ`)
    setRunning(false)
    loadStats()
  }

  const runRegenByCategory = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
    addLog(`เริ่ม regen ตัวอย่างหมวด "${regenCat}"...`)
    let total = 0
    let offset = 0
    let retries = 0
    while (!stopRef.current) {
      try {
        const r = await adminRegenExamplesByCategory(regenCat, regenLimit, offset)
        const { done, errors, total_in_category, next_offset, last_error } = r.data
        total += done
        retries = 0
        const errNote = last_error ? ` (${last_error})` : ''
        addLog(`✓ regen ${done} คำ | error ${errors}${errNote} | ${next_offset}/${total_in_category} คำ`)
        offset = next_offset
        if (done === 0 && errors === 0) break
        if (next_offset >= total_in_category) break
      } catch (e) {
        retries++
        if (retries <= 3) {
          addLog(`✗ Network error — retry ${retries}/3...`)
          await new Promise((res) => setTimeout(res, 2000 * retries))
        } else {
          addLog(`✗ หยุด — network error เกิน 3 ครั้ง (offset ที่ทำค้างไว้: ${offset})`)
          break
        }
      }
    }
    addLog(`เสร็จ — regen รวม ${total} คำ`)
    setRunning(false)
    loadStats()
  }

  const wipeAll = async () => {
    if (!window.confirm('ลบ examples ทั้งหมดเลยไหม?')) return
    const r = await adminWipeAllExamples()
    addLog(`🗑️ ลบแล้ว ${r.data.deleted} examples`)
    loadStats()
  }

  const toggleImageCategory = (cat) => {
    setImageCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    )
  }

  const saveImageSettings = async () => {
    setSettingsSaving(true)
    try {
      await adminUpdateSettings({ image_categories: imageCategories })
    } finally {
      setSettingsSaving(false)
    }
  }

  const pctEx = exStats ? Math.round((exStats.with_examples / (exStats.total_verified || 1)) * 100) : 0
  const pctEn = enStats ? Math.round((enStats.with_english / (enStats.total_verified || 1)) * 100) : 0

  return (
    <div className="px-4 py-6 space-y-3">

      {/* Image Settings */}
      <Section title="ตั้งค่ารูปประกอบ" badge={imageCategories.length > 0 ? `${imageCategories.length} หมวด` : 'ปิด'}>
        <div className="pt-3">
          <p className="text-xs text-gray-400 mb-3">
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
                >
                  {cat}
                </button>
                {imageCategories.includes(cat) && (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`ลบ cache รูปประกอบหมวด "${cat}" ทั้งหมด?\n\nครั้งถัดไปที่เปิดคำในหมวดนี้จะดึงรูปใหม่อัตโนมัติ`)) return
                      const r = await adminDeleteImageCache(cat)
                      addLog(`ลบ cache รูปหมวด "${cat}" แล้ว ${r.data.deleted} รายการ`)
                    }}
                    className="text-xs bg-chinese-red/80 text-white px-2 py-1.5 rounded-r-full border border-chinese-red border-l-0 font-medium"
                    title={`ลบ cache รูปหมวด ${cat}`}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={saveImageSettings}
            disabled={settingsSaving}
            className="w-full bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {settingsSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึกการตั้งค่า'}
          </button>
          <button
            onClick={async () => {
              const excStr = imageCategories.length > 0 ? ` (ยกเว้นหมวด: ${imageCategories.join(', ')})` : ''
              if (!window.confirm(`ลบ cache รูปทั้งหมด${excStr}?`)) return
              const r = await adminDeleteAllImageCache(imageCategories)
              addLog(`🗑️ ลบ cache รูปทั้งหมดแล้ว ${r.data.deleted} รายการ${excStr}`)
            }}
            className="w-full mt-2 border border-gray-200 text-gray-500 rounded-lg py-2 text-sm"
          >
            🗑️ ลบ cache รูปทั้งหมด {imageCategories.length > 0 && `(ยกเว้น ${imageCategories.length} หมวดที่เลือก)`}
          </button>
        </div>
      </Section>

      {/* English meaning stats */}
      <Section
        title="ความหมายอังกฤษ"
        badge={enStats ? `${enStats.with_english} / ${enStats.total_verified} คำ` : null}
      >
        <div className="pt-3">
          {enStats ? (
            <>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pctEn}%` }} />
              </div>
              <button
                onClick={runBulkEnglish}
                disabled={running || enStats.without_english === 0}
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
                  } catch (e) {
                    addLog(`✗ ${e.response?.data?.detail || e.message}`)
                  }
                }}
                disabled={running}
                className="w-full mt-2 border border-blue-200 text-blue-600 rounded-lg py-2 text-sm disabled:opacity-40"
              >
                🔧 แก้ไข English ที่ยาวเกิน (Gemini thinking)
              </button>
            </>
          ) : <p className="text-xs text-gray-400 mt-2">กำลังโหลด...</p>}
        </div>
      </Section>

      {/* Regen single-english */}
      <Section title="Regen English คำเดียว → หลายความหมาย">
        <div className="pt-3">
          <p className="text-xs text-gray-400 mb-3">คำที่มี english_meaning แค่คำเดียว (ไม่มี comma) — ขอให้ Gemini เพิ่มความหมายให้ครอบคลุม</p>
          <select
            value={singleEngCat}
            onChange={(e) => setSingleEngCat(e.target.value)}
            disabled={running}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
          >
            {SINGLE_ENG_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
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
            <button
              onClick={runRegenSingleEnglish}
              disabled={running || singleEngCount === 0}
              className="w-full bg-blue-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            >
              🔁 Regen English คำเดียว
            </button>
          ) : (
            <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">
              ⏹ หยุด
            </button>
          )}
        </div>
      </Section>

      {/* Examples stats */}
      <Section
        title="ตัวอย่างประโยค"
        badge={exStats ? `${exStats.with_examples} / ${exStats.total_verified} คำ${exStats.with_short_examples > 0 ? ` • ⚠️ สั้น ${exStats.with_short_examples}` : ''}` : null}
      >
        <div className="pt-3">
          {exStats ? (
            <>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pctEx}%` }} />
              </div>
              <div className="flex gap-2">
                {!running ? (
                  <button
                    onClick={runBulkExamples}
                    disabled={exStats.without_examples === 0}
                    className="flex-1 bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                  >
                    ✨ สร้างตัวอย่าง ({exStats.without_examples} คำที่เหลือ)
                  </button>
                ) : (
                  <button onClick={stopAll} className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">
                    ⏹ หยุด
                  </button>
                )}
                <button onClick={loadStats} disabled={running} className="px-3 border border-gray-200 rounded-lg text-sm text-gray-500 disabled:opacity-40">🔄</button>
              </div>
              {exStats.with_short_examples > 0 && (
                <button
                  onClick={runRegenShort}
                  disabled={running}
                  className="w-full mt-2 bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
                >
                  🔧 Regen ตัวอย่างสั้นเกิน ({exStats.with_short_examples} คำ, &lt;10 ตัวอักษร)
                </button>
              )}
              <button
                onClick={wipeAll}
                disabled={running}
                className="w-full mt-2 border border-red-200 text-red-500 rounded-lg py-2 text-sm disabled:opacity-40"
              >
                🗑️ ลบตัวอย่างทั้งหมด (reset)
              </button>
            </>
          ) : <p className="text-xs text-gray-400 mt-2">กำลังโหลด...</p>}
        </div>
      </Section>

      {/* Regen by category */}
      <Section title="Regen ตัวอย่างตามหมวด (ลบ+gen ใหม่)">
        <div className="pt-3">
          <p className="text-xs text-gray-400 mb-3">ใช้ logic ใหม่ — คำแพทย์/กฎหมาย/สำนวนที่ไม่ได้ใช้พูดจะได้ formal_0+formal_1 แทน conv</p>
          <div className="flex gap-2 mb-3">
            <select
              value={regenCat}
              onChange={(e) => setRegenCat(e.target.value)}
              disabled={running}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {REGEN_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={regenLimit}
              onChange={(e) => setRegenLimit(Number(e.target.value))}
              disabled={running}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              {[10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>{n} คำ/รอบ</option>
              ))}
            </select>
          </div>
          {!running ? (
            <button
              onClick={runRegenByCategory}
              disabled={running}
              className="w-full bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            >
              🔁 Regen ตัวอย่างหมวด "{regenCat}"
            </button>
          ) : (
            <button onClick={stopAll} className="w-full bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium">
              ⏹ หยุด
            </button>
          )}
        </div>
      </Section>

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
  )
}
