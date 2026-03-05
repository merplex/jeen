import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminMissed, adminDeleteMissed, adminClearSingleMissed, adminGetWordReports, adminDeleteWordReport } from '../../services/api'
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
  const [clearingSingles, setClearingSingles] = useState(false)
  const [tab, setTab] = useState('missed') // 'missed' | 'reports'

  useEffect(() => {
    adminMissed().then((r) => setItems(r.data))
    adminGetWordReports().then((r) => setReports(r.data))
  }, [])

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
      <div className="flex gap-2 mb-4">
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
    </div>
  )
}
