import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../stores/authStore'
import useSubscriptionStore from '../stores/subscriptionStore'
import { deleteAccount } from '../services/api'
import { CATEGORIES, getCategoryColor, loadFavCategories, saveFavCategories } from '../utils/categories'

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { subscription, fetch: fetchSub } = useSubscriptionStore()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // admin-only: preview tier toggle (local state, resets on refresh)
  const [adminPreviewTier, setAdminPreviewTier] = useState(null) // null | 'learner' | 'superuser'
  const [favCats, setFavCats] = useState(loadFavCategories)
  const [categoryCounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('category_counts') || '{}') } catch { return {} }
  })

  const toggleFavCat = (cat) => {
    setFavCats(prev => {
      const next = prev.includes(cat)
        ? prev.filter(c => c !== cat)
        : [...prev, cat]
      saveFavCategories(next)
      return next
    })
  }

  useEffect(() => {
    if (user) fetchSub()
  }, [user])

  if (!user) { navigate('/login'); return null }

  const handleLogout = () => { logout(); navigate('/') }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    try {
      await deleteAccount()
      logout()
      navigate('/')
    } catch {
      alert('ลบบัญชีไม่สำเร็จ กรุณาลองใหม่')
    }
    setDeleting(false)
  }

  // plan comes from product_id set by admin — "learner" or "superuser" in the string
  const realTier = !subscription
    ? null
    : !subscription.active
    ? 'free'
    : subscription.plan?.toLowerCase().includes('super')
    ? 'superuser'
    : 'learner'
  // admin can toggle tier preview locally (resets on refresh)
  const tier = user?.is_admin && adminPreviewTier !== null ? adminPreviewTier : realTier

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

        {/* Upgrade plans — show for free/learner/superuser, or always for admin */}
        {(tier === 'free' || tier === 'learner' || tier === 'superuser' || user?.is_admin) && (
          <div className="space-y-3">
            {/* Admin tier preview toggle */}
            {user?.is_admin && (
              <div className="bg-gray-100 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-2 font-medium">Admin Preview (local only)</div>
                <div className="flex gap-2">
                  {['free', 'learner', 'superuser'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setAdminPreviewTier(adminPreviewTier === t ? null : t)}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-colors ${
                        tier === t
                          ? 'bg-gray-700 text-white'
                          : 'bg-white text-gray-500 border border-gray-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="text-xs text-gray-400 text-center pt-1">เลือกแผนการใช้งาน</div>

            {/* Learner card */}
            <div className={`bg-white rounded-2xl p-4 shadow-sm border-2 ${tier === 'learner' ? 'border-blue-200 opacity-60' : 'border-blue-100'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-gray-800 text-base">
                    {tier === 'superuser' ? 'Downgrade to Learner' : 'Upgrade to Learner'}
                    {tier === 'learner' && <span className="ml-2 text-xs font-normal text-blue-500">● แผนปัจจุบัน</span>}
                  </div>
                  <div className="text-blue-600 font-semibold text-sm">฿69 / เดือน</div>
                </div>
                <button
                  disabled={tier === 'learner'}
                  onClick={() => alert('Coming soon')}
                  className={`text-sm font-medium px-4 py-2 rounded-xl ${
                    tier === 'learner'
                      ? 'bg-gray-200 text-gray-400 cursor-default'
                      : 'bg-blue-500 text-white'
                  }`}
                >
                  {tier === 'learner' ? 'ใช้งานอยู่' : tier === 'superuser' ? 'Downgrade' : 'สมัคร'}
                </button>
              </div>
              <div className="space-y-1.5 text-sm text-gray-600">
                <div className="flex items-center gap-2"><span className="text-blue-400">✓</span> OCR กล้อง 30 ครั้ง/เดือน</div>
                <div className="flex items-center gap-2"><span className="text-blue-400">✓</span> ฝึกพูด 30 ครั้ง/เดือน</div>
                <div className="flex items-center gap-2"><span className="text-blue-400">✓</span> ค้นหาคำไม่จำกัด</div>
                <div className="flex items-center gap-2"><span className="text-blue-400">✓</span> ปลดล็อค Flash Card ทุก Deck</div>
              </div>
            </div>

            {/* Superuser card */}
            <div className={`bg-white rounded-2xl p-4 shadow-sm border-2 ${tier === 'superuser' ? 'border-yellow-300 opacity-60' : 'border-yellow-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-bold text-gray-800 text-base">
                    Upgrade to Superuser
                    {tier === 'superuser' && <span className="ml-2 text-xs font-normal text-yellow-500">● แผนปัจจุบัน</span>}
                  </div>
                  <div className="text-yellow-600 font-semibold text-sm">฿99 / เดือน</div>
                </div>
                <button
                  disabled={tier === 'superuser'}
                  onClick={() => alert('Coming soon')}
                  className={`text-sm font-medium px-4 py-2 rounded-xl ${
                    tier === 'superuser'
                      ? 'bg-gray-200 text-gray-400 cursor-default'
                      : 'bg-yellow-500 text-white'
                  }`}
                >
                  {tier === 'superuser' ? 'ใช้งานอยู่' : 'สมัคร'}
                </button>
              </div>
              <div className="space-y-1.5 text-sm text-gray-600">
                {tier === 'learner' ? (
                  <>
                    <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> OCR กล้อง ×10 (300 ครั้ง/เดือน)</div>
                    <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> ฝึกพูด ×10 (300 ครั้ง/เดือน)</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> OCR กล้อง ×100 (300 ครั้ง/เดือน)</div>
                    <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> ฝึกพูด ×100 (300 ครั้ง/เดือน)</div>
                  </>
                )}
                <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> ค้นหาคำไม่จำกัด</div>
                <div className="flex items-center gap-2"><span className="text-yellow-500">✓</span> ปลดล็อค Flash Card ทุก Deck</div>
              </div>
            </div>
          </div>
        )}

        {/* Favorite categories */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-sm text-gray-500 font-medium mb-1">หมวดหมู่โปรด</div>
          <div className="text-xs text-gray-400 mb-3">กดเพื่อเพิ่ม — จะแสดงถัดจาก "ทั้งหมด" ในหน้าค้นหา</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter(cat => (categoryCounts[cat] || 0) > 0).map(cat => {
              const favIdx = favCats.indexOf(cat)
              const isFav = favIdx !== -1
              const color = getCategoryColor(cat)
              return (
                <button
                  key={cat}
                  onClick={() => toggleFavCat(cat)}
                  style={isFav ? { borderColor: color, borderWidth: 2 } : undefined}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                    isFav ? 'bg-white text-gray-700' : 'bg-gray-100 text-gray-500 border-transparent'
                  }`}
                >
                  {isFav && (
                    <span className="text-gray-400 text-xs leading-none">{favIdx + 1}</span>
                  )}
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full bg-red-50 text-red-600 border border-red-200 rounded-xl py-3 font-medium"
        >
          ออกจากระบบ
        </button>

        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full text-gray-400 text-sm py-2"
        >
          ลบบัญชี
        </button>
      </div>

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4">
            <h3 className="font-bold text-gray-800">ลบบัญชี</h3>
            <p className="text-sm text-gray-600">
              ข้อมูลทั้งหมดของคุณจะถูกลบถาวร ได้แก่ ประวัติการค้นหา, flashcard, โน้ต และข้อมูลบัญชี
            </p>
            <p className="text-sm font-medium text-red-600">การดำเนินการนี้ไม่สามารถยกเลิกได้</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {deleting ? 'กำลังลบ...' : 'ยืนยันลบบัญชี'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
