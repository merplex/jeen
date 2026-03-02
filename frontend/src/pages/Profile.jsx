import { useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  if (!user) { navigate('/login'); return null }

  const handleLogout = () => { logout(); navigate('/') }

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-8 text-center">
        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl mx-auto mb-3">
          👤
        </div>
        <h1 className="text-white text-xl font-bold">{user.display_name || user.identifier}</h1>
        {user.is_admin && (
          <span className="bg-chinese-gold text-white text-xs px-3 py-1 rounded-full mt-2 inline-block">
            Admin
          </span>
        )}
      </div>
      <div className="px-4 py-6 space-y-3">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm text-gray-400">Identifier</div>
          <div className="text-gray-800 font-medium">{user.identifier}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm text-gray-400">ประเภท</div>
          <div className="text-gray-800">{user.id_type}</div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full bg-red-50 text-red-600 border border-red-200 rounded-xl py-3 font-medium"
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
