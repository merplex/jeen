import { useState } from 'react'
import { adminImport, adminUpdateWord } from '../../services/api'

export default function ImportWords() {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [reverted, setReverted] = useState({}) // id → 'old'|'new'
  const [reverting, setReverting] = useState({})

  const handleRevert = async (word, to) => {
    setReverting(v => ({ ...v, [word.id]: true }))
    try {
      await adminUpdateWord(word.id, { thai_meaning: to === 'old' ? word.old : word.new })
      setReverted(v => ({ ...v, [word.id]: to }))
    } catch {
      // ignore
    } finally {
      setReverting(v => ({ ...v, [word.id]: false }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await adminImport(fd)
      if (r.data.success === false) {
        setError(r.data.error || 'Import ไม่สำเร็จ')
      } else {
        setResult(r.data)
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-2">Import ไฟล์คำศัพท์</h2>
        <p className="text-sm text-gray-500 mb-4">
          รองรับไฟล์ .xlsx, .xls, .csv<br />
          คอลัมน์ที่รองรับ: chinese/จีน, pinyin/พินอิน, thai/ความหมาย, english, category/หมวด
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files[0])}
            className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-chinese-red file:text-white"
            required
          />
          <button
            type="submit"
            disabled={loading || !file}
            className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold disabled:opacity-60"
          >
            {loading ? 'กำลัง Import...' : 'Import ไฟล์'}
          </button>
        </form>
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        {result && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 space-y-1">
            <p className="font-semibold text-green-700">Import สำเร็จ!</p>
            {result.verified > 0 && (
              <p className="text-sm text-green-600">
                ✓ เพิ่มใหม่: <strong>{result.verified}</strong> คำ
              </p>
            )}
            {result.updated > 0 && (
              <div>
                <button
                  onClick={() => setShowDiff(v => !v)}
                  className="text-sm text-blue-600 hover:underline text-left"
                >
                  ↻ อัปเดตคำแปล: <strong>{result.updated}</strong> คำ
                  {result.updated_words?.length > 0 && (
                    <span className="ml-1">{showDiff ? '▲ ซ่อน' : '▼ ดู diff'}</span>
                  )}
                </button>
                {showDiff && result.updated_words?.length > 0 && (
                  <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
                    {result.updated_words.map((w, i) => {
                      const chosen = reverted[w.id]
                      const busy = reverting[w.id]
                      return (
                        <div key={i} className="bg-white border border-blue-100 rounded-lg p-3 text-xs">
                          <p className="font-semibold text-gray-800 mb-2">{w.chinese} <span className="text-gray-400 font-normal">{w.pinyin}</span></p>
                          <div className="flex gap-2 items-start">
                            <button
                              onClick={() => handleRevert(w, 'old')}
                              disabled={busy || chosen === 'old'}
                              className={`flex-1 rounded-lg border p-2 text-left whitespace-pre-wrap transition ${chosen === 'old' ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:border-orange-300'} ${busy ? 'opacity-50' : ''}`}
                            >
                              <span className="block text-gray-400 mb-0.5">เก่า {chosen === 'old' && '✓'}</span>
                              <span className="text-gray-600">{w.old || '(ว่าง)'}</span>
                            </button>
                            <button
                              onClick={() => handleRevert(w, 'new')}
                              disabled={busy || chosen === 'new'}
                              className={`flex-1 rounded-lg border p-2 text-left whitespace-pre-wrap transition ${chosen === 'new' || !chosen ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-green-300'} ${busy ? 'opacity-50' : ''}`}
                            >
                              <span className="block text-gray-400 mb-0.5">ใหม่ {(chosen === 'new' || !chosen) && '✓'}</span>
                              <span className="text-green-700">{w.new}</span>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {result.updated - result.updated_words.length > 0 && (
                      <p className="text-xs text-gray-400">
                        + อีก {result.updated - result.updated_words.length} คำที่ค่าเหมือนเดิม (ไม่มีการเปลี่ยนแปลง)
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {result.pending > 0 && (
              <p className="text-sm text-orange-600">
                ⏳ รอ Approve: <strong>{result.pending}</strong> คำ (ยังไม่มีคำแปล)
              </p>
            )}
            {result.skipped > 0 && (
              <p className="text-sm text-gray-400">ข้าม (ซ้ำ): {result.skipped} รายการ</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
