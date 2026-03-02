import { useState } from 'react'
import { adminCreateWord } from '../../services/api'

const CATEGORIES = ['ทั่วไป', 'สัตว์', 'แพทย์', 'วิศวกรรม', 'สถานที่', 'กีฬา']

export default function AddWord() {
  const [form, setForm] = useState({ chinese: '', pinyin: '', pinyin_plain: '', thai_meaning: '', english_meaning: '', category: '' })
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess(false)
    try {
      await adminCreateWord(form)
      setSuccess(true)
      setForm({ chinese: '', pinyin: '', pinyin_plain: '', thai_meaning: '', english_meaning: '', category: '' })
    } catch (err) {
      setError(err.response?.data?.detail || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-4">เพิ่มคำศัพท์ใหม่</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { field: 'chinese', label: 'ภาษาจีน *', placeholder: '学习' },
            { field: 'pinyin', label: 'พินอิน (มี tone) *', placeholder: 'xué xí' },
            { field: 'pinyin_plain', label: 'พินอิน (ไม่มี tone)', placeholder: 'xue xi' },
            { field: 'thai_meaning', label: 'ความหมายไทย *', placeholder: 'เรียนรู้, ศึกษา' },
            { field: 'english_meaning', label: 'English (ถ้าไม่กรอก Gemini จะ generate ให้)', placeholder: 'study, learn' },
          ].map(({ field, label, placeholder }) => (
            <div key={field}>
              <label className="text-sm text-gray-600 mb-1 block">{label}</label>
              <input
                value={form[field]}
                onChange={set(field)}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-chinese-red text-sm"
                required={label.endsWith('*')}
              />
            </div>
          ))}
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
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">เพิ่มคำศัพท์สำเร็จ!</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold disabled:opacity-60"
          >
            {loading ? 'กำลังบันทึก...' : 'เพิ่มคำศัพท์'}
          </button>
        </form>
      </div>
    </div>
  )
}
