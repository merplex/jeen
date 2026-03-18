import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { adminCreateWord, adminDeleteMissed, adminUploadWordImage } from '../../services/api'
import { CATEGORIES } from '../../utils/categories'

export default function AddWord() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const missedId = searchParams.get('missed_id') || null
  const initChinese = searchParams.get('chinese') || ''
  const initThai = searchParams.get('thai') || ''

  const [form, setForm] = useState({
    chinese: initChinese,
    pinyin: '',
    thai_meaning: initThai,
    english_meaning: '',
    category: '',
  })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [createdWordId, setCreatedWordId] = useState(null)
  const [imgUploading, setImgUploading] = useState(false)
  const [imgSuccess, setImgSuccess] = useState(false)
  const [imgError, setImgError] = useState('')
  const fileRef = useRef()

  // ถ้า URL params เปลี่ยน (navigate มาใหม่) ให้ reset form
  useEffect(() => {
    setForm({ chinese: initChinese, pinyin: '', thai_meaning: initThai, english_meaning: '', category: '' })
    setSuccess(false); setError(''); setCreatedWordId(null); setImgSuccess(false); setImgError('')
  }, [initChinese, initThai])

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }))
    if (error) setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess(false)
    try {
      const payload = { ...form }
      if (!payload.pinyin) delete payload.pinyin
      const res = await adminCreateWord(payload)
      // ถ้ามาจาก missed search → ลบออกจาก list แล้ว navigate กลับ
      if (missedId) {
        await adminDeleteMissed(missedId).catch(() => {})
        navigate('/admin/report/missed')
        return
      }
      setSuccess(true)
      setCreatedWordId(res.data.id)
      setForm({ chinese: '', pinyin: '', thai_meaning: '', english_meaning: '', category: '' })
    } catch (err) {
      setError(err.response?.data?.detail || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">เพิ่มคำศัพท์ใหม่</h2>
          {missedId && (
            <span className="text-xs bg-chinese-red/10 text-chinese-red px-2 py-1 rounded-full">
              จากคำค้นไม่พบ
            </span>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">ภาษาจีน *</label>
            <input
              value={form.chinese}
              onChange={set('chinese')}
              placeholder="学习"
              required
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">
              Pinyin
              <span className="text-gray-400 ml-1">(ถ้าคำจีนนี้มีอยู่แล้วแต่ออกเสียงต่างกัน)</span>
            </label>
            <input
              value={form.pinyin}
              onChange={set('pinyin')}
              placeholder="เช่น hao4 หรือ hao4chi1"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              ตัวเลข 1-4 = เสียงวรรณยุกต์ เช่น hao3 = hǎo, hao4 = hào
            </p>
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">ความหมายไทย *</label>
            <textarea
              value={form.thai_meaning}
              onChange={set('thai_meaning')}
              placeholder={"เรียนรู้\nศึกษา\n(แต่ละความหมายแยกบรรทัด)"}
              required
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm resize-none"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">
              English
              <span className="text-gray-400 ml-1">(ถ้าไม่กรอก Gemini จะ generate ให้)</span>
            </label>
            <input
              value={form.english_meaning}
              onChange={set('english_meaning')}
              placeholder="study, learn"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">หมวดหมู่</label>
            <select
              value={form.category}
              onChange={set('category')}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm bg-white"
            >
              <option value="">-- เลือกหมวด --</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <p className="text-xs text-gray-400">ถ้าไม่กรอก Pinyin ระบบจะ generate อัตโนมัติจากคำจีน</p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
          {success && (
            <div className="space-y-2">
              <p className="text-green-600 text-sm">เพิ่มคำศัพท์สำเร็จ!</p>
              <div className="border border-gray-200 rounded-xl p-3 space-y-2">
                <p className="text-xs text-gray-500">เพิ่มรูปประกอบ (ไม่บังคับ)</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return
                    setImgUploading(true); setImgError(''); setImgSuccess(false)
                    try {
                      await adminUploadWordImage(createdWordId, file)
                      setImgSuccess(true)
                    } catch {
                      setImgError('อัปโหลดรูปไม่สำเร็จ')
                    } finally { setImgUploading(false) }
                  }}
                />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={imgUploading}
                  className="w-full border border-dashed border-gray-300 rounded-xl py-2 text-sm text-gray-500 hover:border-chinese-red hover:text-chinese-red transition-colors disabled:opacity-60"
                >
                  {imgUploading ? 'กำลังอัปโหลด...' : imgSuccess ? '✓ อัปโหลดรูปสำเร็จ' : '+ เลือกรูป'}
                </button>
                {imgError && <p className="text-red-500 text-xs">{imgError}</p>}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-chinese-red text-white py-3 rounded-xl font-semibold disabled:opacity-60"
            >
              {loading ? 'กำลังบันทึก...' : 'เพิ่มคำศัพท์'}
            </button>
            {missedId && (
              <button
                type="button"
                onClick={() => navigate('/admin/missed')}
                className="px-4 border border-gray-200 rounded-xl text-sm text-gray-500"
              >
                ยกเลิก
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
