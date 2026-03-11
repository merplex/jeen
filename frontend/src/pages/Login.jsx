import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App } from '@capacitor/app'
import useAuthStore from '../stores/authStore'
import { emailLogin, getMe } from '../services/api'

const base = import.meta.env.VITE_API_URL || '/api'
const LINE_LOGIN_URL_NATIVE = `${base}/auth/line?native=1`
const LINE_LOGIN_URL_WEB = `${base}/auth/line`

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(() => {
    const e = searchParams.get('error')
    if (e === 'line_denied') return 'ยกเลิกการเข้าสู่ระบบด้วย LINE'
    if (e === 'line_token_failed' || e === 'line_profile_failed' || e === 'line') return 'LINE Login ไม่สำเร็จ กรุณาลองใหม่'
    return ''
  })

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith('com.jeen.dictionary://line-callback')) return
      await Browser.close()
      const token = new URL(url).searchParams.get('token')
      if (!token) { setError('LINE Login ไม่สำเร็จ'); return }
      try {
        localStorage.setItem('token', token)
        const meRes = await getMe()
        useAuthStore.setState({ token, user: meRes.data })
        navigate('/', { replace: true })
      } catch {
        localStorage.removeItem('token')
        setError('LINE Login ไม่สำเร็จ กรุณาลองใหม่')
      }
    })
    return () => { listener.then(l => l.remove()) }
  }, [])

  const handleLineLogin = async () => {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: LINE_LOGIN_URL_NATIVE })
    } else {
      window.location.href = LINE_LOGIN_URL_WEB
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const res = await emailLogin(email.trim().toLowerCase(), password)
      const token = res.data.token
      localStorage.setItem('token', token)
      useAuthStore.setState({ token })
      const meRes = await getMe()
      useAuthStore.setState({ user: meRes.data })
      if (!Capacitor.isNativePlatform()) {
        if (meRes.data?.is_admin) {
          navigate('/admin', { replace: true })
        } else {
          setError('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานเว็บ')
        }
      } else {
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'เข้าสู่ระบบไม่สำเร็จ')
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
        <button
          onClick={handleLineLogin}
          className="flex items-center justify-center gap-3 w-full bg-[#06C755] text-white py-3 rounded-xl font-semibold text-base mb-4"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.070 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
          </svg>
          เข้าสู่ระบบด้วย LINE
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">หรือเข้าสู่ระบบด้วยอีเมล</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Email + Password login */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">อีเมล</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              placeholder="your@email.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 mb-1 block">รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-chinese-red bg-white"
              autoComplete="current-password"
              required
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

        <div className="flex items-center justify-between mt-4 text-sm">
          <Link to="/register" className="text-chinese-red">
            ยังไม่มีบัญชี? สมัครสมาชิก
          </Link>
          <Link to="/register?mode=reset" className="text-gray-400">
            ลืมรหัสผ่าน?
          </Link>
        </div>
      </div>
    </div>
  )
}
