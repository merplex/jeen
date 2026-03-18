import { NavLink, Outlet } from 'react-router-dom'

const SUB_TABS = [
  { to: '/admin/report/missed', label: 'รายงาน' },
  { to: '/admin/report/activity', label: 'ประวัติ' },
]

export default function ReportSection() {
  return (
    <div>
      <div className="flex gap-2 px-4 pt-4 pb-2">
        {SUB_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                isActive
                  ? 'bg-chinese-red text-white border-chinese-red'
                  : 'bg-white text-gray-600 border-gray-200'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}
