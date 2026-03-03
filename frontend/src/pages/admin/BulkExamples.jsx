import { useEffect, useState, useRef } from 'react'
import { adminExamplesStats, adminWipeAllExamples, adminBulkGenerateExamples } from '../../services/api'

export default function BulkExamples() {
  const [stats, setStats] = useState(null)
  const [log, setLog] = useState([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  const loadStats = async () => {
    const r = await adminExamplesStats()
    setStats(r.data)
  }

  useEffect(() => { loadStats() }, [])

  const addLog = (msg) => setLog((prev) => [...prev, msg])

  const runBulk = async () => {
    if (running) return
    setRunning(true)
    stopRef.current = false
    setLog([])
    addLog('เริ่มสร้างตัวอย่าง...')

    let totalDone = 0
    let totalErrors = 0

    while (!stopRef.current) {
      try {
        const r = await adminBulkGenerateExamples(30)
        const { done, errors, remaining } = r.data
        totalDone += done
        totalErrors += errors
        addLog(`✓ สร้างแล้ว ${done} คำ | error ${errors} | เหลือ ${remaining} คำ`)
        if (remaining === 0 || done === 0) break
      } catch (e) {
        addLog(`✗ error: ${e.response?.data?.detail || e.message}`)
        break
      }
    }

    addLog(`เสร็จสิ้น — รวม ${totalDone} คำ, error ${totalErrors} คำ`)
    setRunning(false)
    loadStats()
  }

  const stopBulk = () => {
    stopRef.current = true
    addLog('หยุดหลังรอบนี้เสร็จ...')
  }

  const wipeAll = async () => {
    if (!window.confirm('ลบ examples ทั้งหมดทุกคำเลยไหม? ทำไม่ได้ผลอีก!')) return
    try {
      const r = await adminWipeAllExamples()
      addLog(`🗑️ ลบแล้ว ${r.data.deleted} examples`)
      loadStats()
    } catch (e) {
      addLog(`✗ ลบไม่สำเร็จ: ${e.response?.data?.detail || e.message}`)
    }
  }

  const pct = stats ? Math.round((stats.with_examples / (stats.total_verified || 1)) * 100) : 0

  return (
    <div className="px-4 py-6 space-y-4">
      {/* Stats */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">สถานะตัวอย่าง</h2>
        {stats ? (
          <>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">มีตัวอย่างแล้ว</span>
              <span className="font-medium text-green-600">{stats.with_examples} / {stats.total_verified} คำ</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>ยังไม่มี: {stats.without_examples} คำ</span>
              <span>{pct}%</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400">กำลังโหลด...</p>
        )}
      </div>

      {/* Actions */}
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-500">จัดการตัวอย่าง</h2>

        <div className="flex gap-2">
          {!running ? (
            <button
              onClick={runBulk}
              disabled={stats?.without_examples === 0}
              className="flex-1 bg-chinese-red text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            >
              ✨ สร้างตัวอย่าง ({stats?.without_examples ?? '...'} คำที่เหลือ)
            </button>
          ) : (
            <button
              onClick={stopBulk}
              className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              ⏹ หยุด
            </button>
          )}
          <button
            onClick={loadStats}
            disabled={running}
            className="px-3 border border-gray-200 rounded-lg text-sm text-gray-500 disabled:opacity-40"
          >
            🔄
          </button>
        </div>

        <button
          onClick={wipeAll}
          disabled={running}
          className="w-full border border-red-200 text-red-500 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
        >
          🗑️ ลบตัวอย่างทั้งหมด (reset)
        </button>
        <p className="text-[11px] text-gray-400">ลบแล้วกด "สร้างตัวอย่าง" ใหม่ได้เลย</p>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 space-y-1">
          <p className="text-xs text-gray-400 mb-2">Log</p>
          {log.map((l, i) => (
            <p key={i} className="text-xs text-green-400 font-mono">{l}</p>
          ))}
          {running && (
            <p className="text-xs text-yellow-400 font-mono animate-pulse">กำลังทำงาน...</p>
          )}
        </div>
      )}
    </div>
  )
}
