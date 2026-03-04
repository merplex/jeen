import { useEffect, useState, useRef } from 'react'
import {
  adminExamplesStats, adminWipeAllExamples, adminBulkGenerateExamples,
  adminEnglishStats, adminBulkGenerateEnglish, adminFixLongEnglish,
} from '../../services/api'

export default function BulkExamples() {
  const [exStats, setExStats] = useState(null)
  const [enStats, setEnStats] = useState(null)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  const loadStats = async () => {
    const [ex, en] = await Promise.all([adminExamplesStats(), adminEnglishStats()])
    setExStats(ex.data)
    setEnStats(en.data)
  }

  useEffect(() => { loadStats() }, [])

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

  const wipeAll = async () => {
    if (!window.confirm('ลบ examples ทั้งหมดเลยไหม?')) return
    const r = await adminWipeAllExamples()
    addLog(`🗑️ ลบแล้ว ${r.data.deleted} examples`)
    loadStats()
  }

  const pctEx = exStats ? Math.round((exStats.with_examples / (exStats.total_verified || 1)) * 100) : 0
  const pctEn = enStats ? Math.round((enStats.with_english / (enStats.total_verified || 1)) * 100) : 0

  return (
    <div className="px-4 py-6 space-y-4">

      {/* English meaning stats */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">ความหมายอังกฤษ</h2>
          {enStats && <span className="text-xs text-gray-400">{enStats.with_english} / {enStats.total_verified} คำ</span>}
        </div>
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
        ) : <p className="text-xs text-gray-400">กำลังโหลด...</p>}
      </div>

      {/* Examples stats */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500">ตัวอย่างประโยค</h2>
          {exStats && <span className="text-xs text-gray-400">{exStats.with_examples} / {exStats.total_verified} คำ</span>}
        </div>
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
            <button
              onClick={wipeAll}
              disabled={running}
              className="w-full mt-2 border border-red-200 text-red-500 rounded-lg py-2 text-sm disabled:opacity-40"
            >
              🗑️ ลบตัวอย่างทั้งหมด (reset)
            </button>
          </>
        ) : <p className="text-xs text-gray-400">กำลังโหลด...</p>}
      </div>

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
