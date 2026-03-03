import { useEffect, useState } from 'react'
import { adminActivityLog } from '../../services/api'

const ACTION_META = {
  word_added:      { icon: '➕', label: 'เพิ่มคำศัพท์',        color: 'text-green-600' },
  word_edited:     { icon: '✏️', label: 'แก้ไขคำศัพท์',        color: 'text-blue-600' },
  word_deleted:    { icon: '🗑️', label: 'ลบคำศัพท์',           color: 'text-red-500' },
  meaning_changed: { icon: '✏️', label: 'แก้ความหมาย',         color: 'text-blue-600' },
  example_added:   { icon: '📝', label: 'สร้างตัวอย่างประโยค', color: 'text-purple-600' },
  example_deleted: { icon: '🗑️', label: 'ลบตัวอย่างประโยค',   color: 'text-red-400' },
  bulk_english:    { icon: '🌐', label: 'เพิ่มความหมายอังกฤษ', color: 'text-sky-600' },
  bulk_examples:   { icon: '✨', label: 'สร้างตัวอย่างแบบ bulk', color: 'text-amber-600' },
}

function relativeTime(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return 'เมื่อกี้'
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`
  return `${Math.floor(diff / 86400)} วันที่แล้ว`
}

export default function ActivityLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const r = await adminActivityLog(100)
      setLogs(r.data)
    } catch {
      // ignore
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="px-4 py-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500">ประวัติการเปลี่ยนแปลง</h2>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          {loading ? '...' : '🔄 รีเฟรช'}
        </button>
      </div>

      {loading && (
        <p className="text-xs text-gray-400 text-center py-8">กำลังโหลด...</p>
      )}

      {!loading && logs.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-8">ยังไม่มีประวัติ</p>
      )}

      {!loading && logs.map((log) => {
        const meta = ACTION_META[log.action] || { icon: '•', label: log.action, color: 'text-gray-500' }
        return (
          <div key={log.id} className="bg-white rounded-xl px-4 py-3 shadow-sm flex items-start gap-3">
            <span className="text-base mt-0.5">{meta.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
                {log.chinese && (
                  <span className="text-sm font-bold text-gray-800">{log.chinese}</span>
                )}
              </div>
              {log.detail && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{log.detail}</p>
              )}
            </div>
            <span className="text-xs text-gray-300 whitespace-nowrap shrink-0 mt-0.5">
              {relativeTime(log.created_at)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
