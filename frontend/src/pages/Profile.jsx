import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import useSubscriptionStore from '../stores/subscriptionStore'

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { subscription, fetch: fetchSub } = useSubscriptionStore()

  useEffect(() => {
    if (user) fetchSub()
  }, [user])

  if (!user) { navigate('/login'); return null }

  const handleLogout = () => { logout(); navigate('/') }

  const subBadge = () => {
    if (!subscription) return null
    if (subscription.active) {
      const label = subscription.purchase_type === 'one_time' ? 'Premium (ตลอดชีพ)' : 'Premium'
      return (
        <span className="bg-yellow-400 text-yellow-900 text-xs px-3 py-1 rounded-full mt-2 inline-block font-medium">
          {label}
        </span>
      )
    }
    return (
      <span className="bg-white/20 text-white text-xs px-3 py-1 rounded-full mt-2 inline-block">
        Free
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-8 text-center">
        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl mx-auto mb-3">
          👤
        </div>
        <h1 className="text-white text-xl font-bold">{user.display_name || user.identifier}</h1>
        <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
          {user.is_admin && (
            <span className="bg-chinese-gold text-white text-xs px-3 py-1 rounded-full inline-block">
              Admin
            </span>
          )}
          {subBadge()}
        </div>
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

        {/* Subscription card */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm text-gray-400 mb-2">แผนการใช้งาน</div>
          {!subscription ? (
            <div className="text-gray-400 text-sm">กำลังโหลด...</div>
          ) : subscription.active ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="text-yellow-500 text-lg">★</span>
                <span className="text-gray-800 font-medium">
                  {subscription.purchase_type === 'one_time' ? 'Premium ตลอดชีพ' : 'Premium'}
                </span>
              </div>
              {subscription.expires_at && (
                <div className="text-xs text-gray-400 mt-1">
                  หมดอายุ: {new Date(subscription.expires_at).toLocaleDateString('th-TH')}
                </div>
              )}
              {subscription.platform && (
                <div className="text-xs text-gray-400">
                  ผ่าน: {subscription.platform}
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">Free — ใช้งานได้ทุกฟีเจอร์</div>
          )}
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
