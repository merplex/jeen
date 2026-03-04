import { useEffect, useState } from 'react'
import {
  adminListSubscriptions,
  adminGrantSubscription,
  adminCancelSubscription,
} from '../../services/api'

export default function Subscriptions() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGrant, setShowGrant] = useState(false)
  const [form, setForm] = useState({
    user_id: '',
    product_id: 'manual_grant',
    purchase_type: 'subscription',
    expires_at: '',
    note: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminListSubscriptions()
      setSubs(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleGrant = async () => {
    if (!form.user_id) return
    try {
      await adminGrantSubscription({
        user_id: parseInt(form.user_id),
        product_id: form.product_id,
        purchase_type: form.purchase_type,
        expires_at: form.expires_at || null,
        note: form.note || null,
      })
      setShowGrant(false)
      setForm({ user_id: '', product_id: 'manual_grant', purchase_type: 'subscription', expires_at: '', note: '' })
      load()
    } catch (e) {
      alert(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
    }
  }

  const handleCancel = async (id) => {
    if (!confirm('ยกเลิก subscription นี้?')) return
    await adminCancelSubscription(id)
    load()
  }

  const statusColor = (s) => ({
    active: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-500',
    pending: 'bg-yellow-100 text-yellow-700',
  }[s] || 'bg-gray-100 text-gray-500')

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">Subscriptions ({subs.length})</h2>
        <button
          onClick={() => setShowGrant(true)}
          className="bg-chinese-red text-white text-sm px-4 py-2 rounded-lg"
        >
          + มอบ subscription
        </button>
      </div>

      {/* Grant modal */}
      {showGrant && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-bold text-gray-800">มอบ Subscription</h3>
            <input
              type="number"
              placeholder="User ID"
              value={form.user_id}
              onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={form.purchase_type}
              onChange={e => setForm(f => ({ ...f, purchase_type: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="subscription">Subscription (มีวันหมด)</option>
              <option value="one_time">One-time (ตลอดชีพ)</option>
            </select>
            <input
              type="text"
              placeholder="Product ID (เช่น monthly_sub)"
              value={form.product_id}
              onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            {form.purchase_type === 'subscription' && (
              <div>
                <label className="text-xs text-gray-500">วันหมดอายุ (ว่าง = ไม่มีวันหมด)</label>
                <input
                  type="datetime-local"
                  value={form.expires_at}
                  onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                />
              </div>
            )}
            <input
              type="text"
              placeholder="หมายเหตุ (optional)"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowGrant(false)}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleGrant}
                className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium"
              >
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center text-gray-400 py-8">กำลังโหลด...</div>
      ) : subs.length === 0 ? (
        <div className="text-center text-gray-400 py-8">ยังไม่มี subscription</div>
      ) : (
        <div className="space-y-2">
          {subs.map(sub => (
            <div key={sub.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">User #{sub.user_id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(sub.status)}`}>
                      {sub.status}
                    </span>
                    <span className="text-xs text-gray-400">{sub.platform}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">{sub.product_id} · {sub.purchase_type}</div>
                  {sub.expires_at && (
                    <div className="text-xs text-gray-400">
                      หมด: {new Date(sub.expires_at).toLocaleDateString('th-TH')}
                    </div>
                  )}
                  {sub.note && <div className="text-xs text-gray-400 italic">{sub.note}</div>}
                  <div className="text-xs text-gray-300 mt-1">
                    สร้าง: {new Date(sub.created_at).toLocaleDateString('th-TH')}
                  </div>
                </div>
                {sub.status === 'active' && (
                  <button
                    onClick={() => handleCancel(sub.id)}
                    className="text-xs text-red-500 border border-red-200 px-2 py-1 rounded-lg whitespace-nowrap"
                  >
                    ยกเลิก
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
