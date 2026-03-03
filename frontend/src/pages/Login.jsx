import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

const LINE_LOGIN_URL = `${import.meta.env.VITE_API_URL || '/api'}/auth/line`

const ID_TYPES = [
  { value: 'email', label: 'อีเมล', placeholder: 'your@email.com', icon: '📧' },
  { value: 'line', label: 'Line', placeholder: 'Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', icon: '💬' },
]

function validateIdentifier(idType, value) {
  if (!value.trim()) return 'กรุณากรอกข้อมูล'
  if (idType === 'email') {
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(value.trim())) return 'รูปแบบอีเมลไม่ถูกต้อง'
  } else if (idType === 'line') {
    if (!/^U[0-9a-fA-F]{10,}$/.test(value.trim()))
      return 'Line User ID ต้องขึ้นต้นด้วย U ตามด้วยตัวเลข/ตัวอักษร'
  }
  return ''
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, loading } = useAuthStore()
  const [idType, setIdType] = useState('email')
  const [identifier, setIdentifier] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(
    searchParams.get('error') === 'line' ? 'LINE Login ไม่สำเร็จ กรุณาลองใหม่' : ''
  )

  const selected = ID_TYPES.find((t) => t.value === idType)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const validationError = validateIdentifier(idType, identifier)
    if (validationError) { setError(validationError); return }
    setError('')
    const result = await login(identifier.trim(), idType, displayName.trim() || undefined)
    if (result.ok) {
      navigate('/', { replace: true })
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

        {/* LINE Login */}
        <a
          href={LINE_LOGIN_URL}
          className="flex items-center justify-center gap-3 w-full bg-[#06C755] text-white py-3 rounded-xl font-semibold text-base mb-4"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
          </svg>
          เข้าสู่ระบบด้วย LINE
        </a>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">หรือ</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <div className="flex gap-2 mb-6">
          {ID_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => { setIdType(t.value); setIdentifier(''); setError('') }}
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
              onChange={(e) => { setIdentifier(e.target.value); setError('') }}
              placeholder={selected?.placeholder}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
              required
            />
            {idType === 'line' && (
              <p className="text-xs text-gray-400 mt-1">
                Line User ID — เปิด Line → โปรไฟล์ → กด ID เพื่อดู หรือตั้งค่า → บัญชี
              </p>
            )}
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
