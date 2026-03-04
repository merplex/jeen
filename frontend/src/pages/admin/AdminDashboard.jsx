import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/admin/pending', label: 'รอ Approve' },
  { to: '/admin/missed', label: 'ค้นไม่พบ' },
  { to: '/admin/import', label: 'Import' },
  { to: '/admin/add', label: 'เพิ่มคำ' },
  { to: '/admin/examples', label: 'ตัวอย่าง' },
  { to: '/admin/activity', label: 'ประวัติ' },
  { to: '/admin/subscriptions', label: 'Subscription' },
]

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <div className="bg-chinese-red px-4 pt-12 pb-4">
        <h1 className="text-white text-xl font-bold">⚙️ Admin</h1>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-chinese-red'
                    : 'bg-white/20 text-white'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
      <Outlet />
    </div>
  )
}
