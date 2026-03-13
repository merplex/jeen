import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminMissed, adminDeleteMissed, adminClearSingleMissed, adminGetWordReports, adminDeleteWordReport, adminGeminiQuota, adminImageStorage } from '../../services/api'
import { thaiDateTime } from '../../utils/time'

function detectLang(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return 'chinese'
  if (/[\u0e00-\u0e7f]/.test(text)) return 'thai'
  return 'other'
}

export default function MissedSearches() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [reports, setReports] = useState([])
  const [sysStatus, setSysStatus] = useState(null)
  const [clearingSingles, setClearingSingles] = useState(false)
  const [tab, setTab] = useState('missed') // 'missed' | 'reports' | 'system'

  useEffect(() => {
    adminMissed().then((r) => setItems(r.data))
    adminGetWordReports().then((r) => setReports(r.data))
  }, [])

  const loadSystem = () => {
    Promise.all([adminGeminiQuota(), adminImageStorage()]).then(([q, s]) => {
      setSysStatus({ quota: q.data, storage: s.data })
    })
  }

  useEffect(() => {
    if (tab === 'system') loadSystem()
  }, [tab])

  const handleDelete = async (id) => {
    await adminDeleteMissed(id)
    setItems((prev) => prev.filter((x) => x.id !== id))
  }

  const handleClearSingles = async () => {
    setClearingSingles(true)
    try {
      await adminClearSingleMissed()
      setItems((prev) => prev.filter((x) => x.count > 1))
    } finally {
      setClearingSingles(false)
    }
  }

  const handleAddWord = (item) => {
    const lang = detectLang(item.query)
    const params = new URLSearchParams({ missed_id: item.id })
    if (lang === 'chinese') params.set('chinese', item.query)
    else if (lang === 'thai') params.set('thai', item.query)
    navigate(`/admin/add?${params.toString()}`)
  }

  const handleCheckReport = (r) => {
    navigate(`/word/${r.word_id}`, {
      state: {
        reportId: r.id,
        reportMsg: r.message,
        reportUserName: r.user_name,
      },
    })
  }

  const handleDeleteReport = async (id) => {
    await adminDeleteWordReport(id)
    setReports((prev) => prev.filter((r) => r.id !== id))
  }

  const singlesCount = items.filter((x) => x.count <= 1).length

  return (
    <div className="px-4 py-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setTab('missed')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            tab === 'missed' ? 'bg-chinese-red text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          ค้นไม่พบ ({items.length})
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            tab === 'reports' ? 'bg-yellow-400 text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          ⚠️ รายงาน ({reports.length})
        </button>
        <button
          onClick={() => setTab('system')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            tab === 'system' ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-200'
          }`}
        >
          ระบบ
        </button>
      </div>

      {tab === 'missed' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">{items.length} คำที่ค้นแล้วไม่พบ</p>
            {singlesCount > 0 && (
              <button
                onClick={handleClearSingles}
                disabled={clearingSingles}
                className="text-xs text-red-400 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                {clearingSingles ? '...' : `ล้างค้นครั้งเดียว (${singlesCount})`}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-xl px-4 py-3 shadow-sm flex justify-between items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800">{item.query}</div>
                  <div className="text-xs text-gray-400">
                    ค้นหาล่าสุด: {thaiDateTime(item.last_searched_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="bg-chinese-red text-white text-sm font-bold px-3 py-1 rounded-full">
                    {item.count}
                  </div>
                  <button
                    onClick={() => handleAddWord(item)}
                    className="text-xs text-chinese-red border border-chinese-red/30 rounded-lg px-2 py-1 hover:bg-chinese-red/5"
                  >
                    + เพิ่ม
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="text-center text-gray-400 py-12">ยังไม่มีคำที่ค้นไม่พบ</div>
            )}
          </div>
        </>
      )}

      {tab === 'reports' && (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="bg-white rounded-xl px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-chinese text-lg text-chinese-red">{r.word_chinese}</span>
                    <span className="text-xs text-gray-400">{r.word_pinyin}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{r.message}</p>
                  <div className="text-xs text-gray-400 mt-1">
                    โดย {r.user_name} · {thaiDateTime(r.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleCheckReport(r)}
                    className="text-xs text-yellow-600 border border-yellow-300 rounded-lg px-2 py-1 hover:bg-yellow-50"
                  >
                    เช็ค
                  </button>
                  <button
                    onClick={() => handleDeleteReport(r.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <div className="text-center text-gray-400 py-12">ยังไม่มีรายงานคำศัพท์</div>
          )}
        </div>
      )}

      {tab === 'system' && (
        <div className="space-y-4">
          {!sysStatus ? (
            <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>
          ) : (
            <>
              {/* Gemini Quota */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-700">Gemini API (วันนี้)</h3>
                  <button onClick={loadSystem} className="text-xs text-blue-400 border border-blue-200 rounded-lg px-2 py-1">รีเฟรช</button>
                </div>
                <div className="space-y-2">
                  {[
                    { label: 'รายวัน', used: sysStatus.quota.daily_used, limit: sysStatus.quota.daily_limit },
                    { label: 'รายชั่วโมง', used: sysStatus.quota.hourly_used, limit: sysStatus.quota.hourly_limit },
                  ].map(({ label, used, limit }) => {
                    const pct = Math.min((used / limit) * 100, 100)
                    const color = pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-yellow-400' : 'bg-green-400'
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{label}</span>
                          <span>{used} / {limit}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                {sysStatus.quota.example_queue_pending > 0 && (
                  <p className="text-xs text-gray-400 mt-2">คิว gen ตัวอย่าง: {sysStatus.quota.example_queue_pending} คำรอ</p>
                )}
              </div>

              {/* Image Storage */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-700">รูปภาพใน DB</h3>
                  <button onClick={loadSystem} className="text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5">🔄 รีเฟรช</button>
                </div>
                {(() => {
                  const { used_mb, limit_mb, used_percent, image_count, by_source } = sysStatus.storage
                  const color = used_percent > 80 ? 'bg-red-400' : used_percent > 50 ? 'bg-yellow-400' : 'bg-blue-400'
                  const SOURCE_LABEL = {
                    google_places: 'Google Places',
                    admin_upload: 'Admin',
                    spoonacular: 'Spoonacular',
                    wikipedia: 'Wikipedia',
                    unknown: 'ไม่ทราบ',
                  }
                  return (
                    <>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>รวม {image_count} รูป</span>
                        <span>{used_mb} MB (binary) / {limit_mb} MB</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-3">
                        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(used_percent, 100)}%` }} />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(by_source || {}).map(([src, info]) => (
                          <div key={src} className="flex justify-between items-center bg-gray-50 rounded-lg px-2.5 py-1.5">
                            <span className="text-xs text-gray-600">{SOURCE_LABEL[src] || src}</span>
                            <div className="text-right">
                              <span className="text-xs font-medium text-gray-700">{info.count} รูป</span>
                              {info.mb > 0 && <span className="text-xs text-gray-400 ml-1">({info.mb} MB)</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
