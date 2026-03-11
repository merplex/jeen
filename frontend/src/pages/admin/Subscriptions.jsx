import { useEffect, useState } from 'react'
import {
  adminSetUserTier,
  adminListTieredUsers,
  adminGetFlaggedUsers,
  adminUnflagUser,
} from '../../services/api'
import { thaiDateTime } from '../../utils/time'

const TIERS = [
  { value: 'superuser', label: 'Superuser', desc: 'ใช้ได้ทุกอย่าง ไม่จำกัด', color: 'bg-purple-100 text-purple-700' },
  { value: 'lifetime', label: 'Lifetime', desc: 'ซื้อตลอดชีพ ไม่จำกัด', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'learner', label: 'Learner', desc: 'ใช้ได้บางฟีเจอร์ มีจำกัด', color: 'bg-blue-100 text-blue-700' },
  { value: 'reduser', label: 'Reduser', desc: 'ผู้ใช้ทั่วไป มีลิมิต', color: 'bg-gray-100 text-gray-500' },
]

const tierColor = (t) => TIERS.find(x => x.value === t)?.color || 'bg-gray-100 text-gray-500'
const tierLabel = (t) => TIERS.find(x => x.value === t)?.label || t

export default function Subscriptions() {
  const [tieredUsers, setTieredUsers] = useState([])
  const [flaggedUsers, setFlaggedUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ identifier: '', tier: 'superuser', note: '' })
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [tieredRes, flaggedRes] = await Promise.all([
        adminListTieredUsers(),
        adminGetFlaggedUsers(),
      ])
      setTieredUsers(tieredRes.data)
      setFlaggedUsers(flaggedRes.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSetTier = async () => {
    if (!form.identifier.trim()) return
    setFormError('')
    setFormLoading(true)
    try {
      await adminSetUserTier({
        identifier: form.identifier.trim(),
        tier: form.tier,
        note: form.note || null,
      })
      setShowForm(false)
      setForm({ identifier: '', tier: 'superuser', note: '' })
      load()
    } catch (e) {
      setFormError(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
    } finally {
      setFormLoading(false)
    }
  }

  const handleChangeTier = async (user, newTier) => {
    try {
      await adminSetUserTier({ identifier: user.identifier, tier: newTier })
      load()
    } catch (e) {
      alert(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
    }
  }

  const handleUnflag = async (userId) => {
    await adminUnflagUser(userId)
    setFlaggedUsers((prev) => prev.filter((u) => u.id !== userId))
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">จัดการสิทธิ์ผู้ใช้</h2>
        <button
          onClick={() => setShowForm(true)}
          className="bg-chinese-red text-white text-sm px-4 py-2 rounded-lg"
        >
          + กำหนดสิทธิ์
        </button>
      </div>

      {/* Tier legend */}
      <div className="grid grid-cols-2 gap-2">
        {TIERS.map(t => (
          <div key={t.value} className={`rounded-lg px-3 py-2 ${t.color}`}>
            <div className="font-semibold text-sm">{t.label}</div>
            <div className="text-xs opacity-75">{t.desc}</div>
          </div>
        ))}
      </div>

      {/* Set tier modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <h3 className="font-bold text-gray-800">กำหนดสิทธิ์ผู้ใช้</h3>
            <div>
              <label className="text-xs text-gray-500">อีเมล หรือ LINE ID</label>
              <input
                type="text"
                placeholder="example@email.com หรือ Uxxxxxxx"
                value={form.identifier}
                onChange={e => setForm(f => ({ ...f, identifier: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">ระดับสิทธิ์</label>
              <select
                value={form.tier}
                onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
              >
                {TIERS.map(t => (
                  <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              placeholder="หมายเหตุ (optional)"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            {formError && <p className="text-red-500 text-xs">{formError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowForm(false); setFormError('') }}
                className="flex-1 border rounded-lg py-2 text-sm text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSetTier}
                disabled={formLoading}
                className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60"
              >
                {formLoading ? 'กำลังบันทึก...' : 'ยืนยัน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flagged Users */}
      {flaggedUsers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-yellow-700">
            ⚠️ ผู้ใช้ที่ต้องตรวจสอบ ({flaggedUsers.length})
          </h3>
          {flaggedUsers.map((u) => (
            <div key={u.id} className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                  className="text-left flex-1 min-w-0"
                >
                  <div className="font-medium text-gray-800">{u.display_name}</div>
                  <div className="text-xs text-gray-400">{u.identifier} · ID #{u.id}</div>
                </button>
                <button
                  onClick={() => handleUnflag(u.id)}
                  className="text-xs text-green-600 border border-green-300 rounded-lg px-2 py-1 shrink-0"
                >
                  ปลดล็อค
                </button>
              </div>
              {expandedUser === u.id && (
                <div className="mt-3 border-t border-yellow-200 pt-3 space-y-1.5">
                  <p className="text-xs font-medium text-gray-500 mb-2">ประวัติค้นหา 10 คำล่าสุด</p>
                  {u.history.length === 0 ? (
                    <p className="text-xs text-gray-400">ไม่มีประวัติ</p>
                  ) : (
                    u.history.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${h.found ? 'bg-green-400' : 'bg-red-300'}`} />
                        <span className="font-medium text-gray-700 flex-1">{h.query}</span>
                        <span className="text-xs text-gray-400">{thaiDateTime(h.searched_at)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tiered users list */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-2">
          ผู้ใช้ที่กำหนดสิทธิ์แล้ว ({tieredUsers.length})
        </h3>
        {loading ? (
          <div className="text-center text-gray-400 py-8">กำลังโหลด...</div>
        ) : tieredUsers.length === 0 ? (
          <div className="text-center text-gray-400 py-8">ยังไม่มีผู้ใช้ที่กำหนดสิทธิ์</div>
        ) : (
          <div className="space-y-2">
            {tieredUsers.map(u => (
              <div key={u.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">
                        {u.display_name || u.identifier}
                      </span>
                      {u.is_admin && (
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">admin</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tierColor(u.tier)}`}>
                        {tierLabel(u.tier)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{u.identifier} · {u.id_type}</div>
                  </div>
                  <select
                    value={u.tier}
                    onChange={e => handleChangeTier(u, e.target.value)}
                    className="text-xs border rounded-lg px-2 py-1.5 shrink-0"
                  >
                    {TIERS.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
