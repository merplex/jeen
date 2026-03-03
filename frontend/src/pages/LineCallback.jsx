import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getMe } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function LineCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    const error = searchParams.get('error')

    if (error || !token) {
      navigate('/login?error=line', { replace: true })
      return
    }

    // บันทึก token แล้วโหลด user
    localStorage.setItem('token', token)
    useAuthStore.setState({ token })

    getMe()
      .then((r) => {
        useAuthStore.setState({ user: r.data })
        navigate('/', { replace: true })
      })
      .catch(() => {
        localStorage.removeItem('token')
        useAuthStore.setState({ token: null, user: null })
        navigate('/login?error=line', { replace: true })
      })
  }, [])

  return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <div className="text-center">
        <div className="font-chinese text-5xl text-chinese-red/30 mb-4">字典</div>
        <p className="text-gray-400">กำลังเข้าสู่ระบบด้วย LINE...</p>
      </div>
    </div>
  )
}
