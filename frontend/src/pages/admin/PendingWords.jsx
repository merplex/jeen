import { useEffect, useState } from 'react'
import { adminGetPending, adminApprove, adminReject } from '../../services/api'

export default function PendingWords() {
  const [words, setWords] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const LIMIT = 50

  const fetch = async (skip = 0) => {
    setLoading(true)
    const r = await adminGetPending(skip, LIMIT)
    setWords(r.data)
    setLoading(false)
  }

  useEffect(() => { fetch(page * LIMIT) }, [page])

  const approve = async (id) => {
    await adminApprove(id)
    setWords((w) => w.filter((x) => x.id !== id))
  }

  const reject = async (id) => {
    if (!confirm('ลบคำนี้ออกจาก pending?')) return
    await adminReject(id)
    setWords((w) => w.filter((x) => x.id !== id))
  }

  return (
    <div className="px-4 py-4">
      <p className="text-sm text-gray-500 mb-4">
        {loading ? 'กำลังโหลด...' : `แสดง ${words.length} รายการ`}
      </p>
      <div className="space-y-3">
        {words.map((w) => (
          <div key={w.id} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-chinese text-xl text-chinese-red">{w.chinese}</div>
                <div className="text-sm text-gray-500">{w.pinyin}</div>
                <div className="text-gray-700">{w.thai_meaning}</div>
                {w.source && (
                  <div className="text-xs text-gray-400 mt-1">แหล่ง: {w.source}</div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => approve(w.id)}
                  className="bg-green-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => reject(w.id)}
                  className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-sm"
                >
                  ✗ Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="flex-1 py-2 border rounded-lg disabled:opacity-40 text-sm"
        >
          ← หน้าก่อน
        </button>
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
