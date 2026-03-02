import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

const ID_TYPES = [
  { value: 'email', label: 'อีเมล', placeholder: 'your@email.com', icon: '📧' },
  { value: 'line', label: 'Line ID', placeholder: '@lineid', icon: '💬' },
  { value: 'phone', label: 'เบอร์โทร', placeholder: '08X-XXX-XXXX', icon: '📱' },
]

export default function Login() {
  const navigate = useNavigate()
  const { login, loading } = useAuthStore()
  const [idType, setIdType] = useState('email')
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')

  const selected = ID_TYPES.find((t) => t.value === idType)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!identifier.trim()) return
    setError('')
    const result = await login(identifier.trim(), idType, displayName.trim() || undefined)
    if (result.ok) {
      navigate('/')
    } else {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่')
    }
  }

  return (
    <div className="min-h-screen bg-chinese-cream flex flex-col pb-24">
      <div className="bg-chinese-red px-4 pt-16 pb-12 text-center">
        <div className="font-chinese text-6xl text-white mb-2">字典</div>
        <p className="text-white/80">พจนานุกรมจีน-ไทย</p>
      </div>

      <div className="px-6 py-8 flex-1">
        <h2 className="text-xl font-bold text-gray-800 mb-6">เข้าสู่ระบบ</h2>

        {/* ID Type selector */}
        <div className="flex gap-2 mb-6">
          {ID_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => { setIdType(t.value); setIdentifier('') }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                idType === t.value
                  ? 'bg-chinese-red text-white'
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">{selected?.label}</label>
            <input
              type={idType === 'email' ? 'email' : 'text'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={selected?.placeholder}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">ชื่อที่แสดง (ไม่บังคับ)</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ชื่อของคุณ"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-60"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          ไม่ต้องลงทะเบียน — กรอก identifier แล้วเข้าใช้ได้เลย
        </p>
      </div>
    </div>
  )
}
