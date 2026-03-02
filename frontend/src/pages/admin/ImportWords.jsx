import { useState } from 'react'
import { adminImport } from '../../services/api'

export default function ImportWords() {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      setResult(r.data)
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
                ✓ เพิ่มลงพจนานุกรมทันที: <strong>{result.verified}</strong> คำ (มีคำแปลไทยแล้ว)
              </p>
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
