import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import useAuthStore from '../stores/authStore'
import { requestEmailOtp, verifyEmailOtp, emailSetPassword, getMe } from '../services/api'

export default function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isReset = searchParams.get('mode') === 'reset'

  // step: 'email' | 'otp' | 'password'
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const handleRequestOtp = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setError('')
    setLoading(true)
    try {
      await requestEmailOtp(email.trim().toLowerCase())
      setStep('otp')
      setInfo(`ส่ง OTP ไปที่ ${email} แล้ว กรุณาตรวจสอบอีเมล (รวมถึงโฟลเดอร์ spam)`)
    } catch (err) {
      setError(err.response?.data?.detail || 'ส่ง OTP ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    if (otp.length !== 6) return
    setError('')
    setLoading(true)
    try {
      await verifyEmailOtp(email.trim().toLowerCase(), otp.trim())
      setStep('password')
      setInfo('')
    } catch (err) {
      setError(err.response?.data?.detail || 'OTP ไม่ถูกต้องหรือหมดอายุ')
    } finally {
      setLoading(false)
    }
  }

  const handleSetPassword = async (e) => {
    e.preventDefault()
    if (password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return }
    if (password !== passwordConfirm) { setError('รหัสผ่านไม่ตรงกัน'); return }
    setError('')
    setLoading(true)
    try {
      const res = await emailSetPassword(email.trim().toLowerCase(), password)
      const token = res.data.token
      localStorage.setItem('token', token)
      useAuthStore.setState({ token })
      const meRes = await getMe()
      useAuthStore.setState({ user: meRes.data })
      if (!Capacitor.isNativePlatform() && !meRes.data?.is_admin) {
        navigate('/login', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setError('')
    setOtp('')
    setLoading(true)
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
        <div className="flex items-center gap-3 mb-6">
          <Link to="/login" className="text-gray-400 text-xl leading-none">←</Link>
          <h2 className="text-xl font-bold text-gray-800">
            {isReset ? 'รีเซ็ตรหัสผ่าน' : 'สมัครสมาชิก'}
          </h2>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {['อีเมล', 'ยืนยัน OTP', 'ตั้งรหัสผ่าน'].map((label, i) => {
            const stepIdx = { email: 0, otp: 1, password: 2 }[step]
            const done = i < stepIdx
            const active = i === stepIdx
            return (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  done ? 'bg-green-500 text-white' : active ? 'bg-chinese-red text-white' : 'bg-gray-200 text-gray-400'
                }`}>
                  {done ? '✓' : i + 1}
                </div>
                <span className={`text-xs ${active ? 'text-chinese-red font-medium' : 'text-gray-400'}`}>{label}</span>
                {i < 2 && <div className="flex-1 h-px bg-gray-200" />}
              </div>
            )
          })}
        </div>

        {/* Step 1: Email */}
        {step === 'email' && (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">อีเมล</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError('') }}
                placeholder="your@email.com"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
                autoComplete="email"
                autoFocus
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-60"
            >
              {loading ? 'กำลังส่ง OTP...' : 'ส่ง OTP ยืนยันอีเมล'}
            </button>
          </form>
        )}

        {/* Step 2: OTP */}
        {step === 'otp' && (
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
                autoComplete="one-time-code"
                autoFocus
                required
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
                className="text-gray-400"
              >
                เปลี่ยนอีเมล
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-chinese-red disabled:opacity-50"
              >
                ส่ง OTP ใหม่
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Set password */}
        {step === 'password' && (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <p className="text-sm text-gray-500 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              ✓ ยืนยันอีเมล <strong>{email}</strong> สำเร็จ
            </p>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">รหัสผ่าน (อย่างน้อย 6 ตัว)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                placeholder="••••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
                autoComplete="new-password"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">ยืนยันรหัสผ่าน</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => { setPasswordConfirm(e.target.value); setError('') }}
                placeholder="••••••"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || !password || !passwordConfirm}
              className="w-full bg-chinese-red text-white py-3 rounded-xl font-semibold text-lg disabled:opacity-60"
            >
              {loading ? 'กำลังสร้างบัญชี...' : isReset ? 'บันทึกรหัสผ่านใหม่' : 'สร้างบัญชี'}
            </button>
          </form>
        )}

        {step === 'email' && (
          <p className="text-center text-sm text-gray-400 mt-6">
            มีบัญชีแล้ว?{' '}
            <Link to="/login" className="text-chinese-red">เข้าสู่ระบบ</Link>
          </p>
        )}
      </div>
    </div>
  )
}
