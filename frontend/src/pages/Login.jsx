import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import { requestEmailOtp, verifyEmailOtp, getMe } from '../services/api'

const LINE_LOGIN_URL = `${import.meta.env.VITE_API_URL || '/api'}/auth/line`

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // step: 'email' | 'otp'
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(() => {
    const e = searchParams.get('error')
    if (e === 'line_denied') return 'ยกเลิกการเข้าสู่ระบบด้วย LINE'
    if (e === 'line_token_failed' || e === 'line_profile_failed') return 'LINE Login ไม่สำเร็จ กรุณาลองใหม่'
    return ''
  })
  const [info, setInfo] = useState('')

  const handleRequestOtp = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('กรุณากรอกอีเมล'); return }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) { setError('รูปแบบอีเมลไม่ถูกต้อง'); return }
    setError(''); setLoading(true)
    try {
      await requestEmailOtp(email.trim().toLowerCase())
      setStep('otp')
      setInfo(`ส่ง OTP ไปที่ ${email} แล้ว กรุณาตรวจสอบอีเมล (รวมถึงโฟลเดอร์ spam)`)
    } catch (err) {
      setError(err.response?.data?.detail || 'ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    if (!otp.trim()) { setError('กรุณากรอก OTP'); return }
    setError(''); setLoading(true)
    try {
      const res = await verifyEmailOtp(email.trim().toLowerCase(), otp.trim())
      const token = res.data.token
      localStorage.setItem('token', token)
      useAuthStore.setState({ token })
      const meRes = await getMe()
      useAuthStore.setState({ user: meRes.data })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'OTP ไม่ถูกต้องหรือหมดอายุ')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setError(''); setOtp(''); setLoading(true)
    try {
      await requestEmailOtp(email.trim().toLowerCase())
      setInfo('ส่ง OTP ใหม่แล้ว กรุณาตรวจสอบอีเมล')
    } catch (err) {
      setError(err.response?.data?.detail || 'ส่ง OTP ไม่สำเร็จ')
    } finally {
      setLoading(false)
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

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">หรือเข้าสู่ระบบด้วยอีเมล</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Email OTP flow */}
        {step === 'email' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">อีเมล</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                placeholder="your@email.com"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
                required
                autoComplete="email"
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-60"
            >
              {loading ? 'กำลังส่ง OTP...' : 'ส่ง OTP ทางอีเมล'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {info && <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">{info}</p>}
            <div>
              <label className="text-sm text-gray-600 mb-1 block">รหัส OTP 6 หลัก</label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                placeholder="000000"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white text-center text-2xl tracking-widest font-mono"
                required
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-60"
            >
              {loading ? 'กำลังตรวจสอบ...' : 'ยืนยัน OTP'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => { setStep('email'); setOtp(''); setError(''); setInfo('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                เปลี่ยนอีเมล
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-chinese-red hover:underline disabled:opacity-50"
              >
                ส่ง OTP ใหม่
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
