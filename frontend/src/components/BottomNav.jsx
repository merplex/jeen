import { NavLink } from 'react-router-dom'
import useAuthStore from '../stores/authStore'

const NAV = [
  { to: '/', label: '搜索', icon: '🔍', text: 'ค้นหา' },
  { to: '/history', label: '历史', icon: '🕐', text: 'ประวัติ' },
  { to: '/learning', label: '学习', icon: '📚', text: 'เรียน' },
  { to: '/notes', label: '笔记', icon: '📝', text: 'โน้ต' },
]

export default function BottomNav() {
  const user = useAuthStore((s) => s.user)

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors ${
                isActive ? 'text-chinese-red' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-xs font-thai">{item.text}</span>
          </NavLink>
        ))}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors ${
                isActive ? 'text-chinese-red' : 'text-gray-500'
              }`
            }
          >
            <span className="text-xl">⚙️</span>
            <span className="text-xs font-thai">Admin</span>
          </NavLink>
        )}
        <NavLink
          to={user ? '/profile' : '/login'}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'text-chinese-red' : 'text-gray-500'
            }`
          }
        >
          <span className="text-xl">{user ? '👤' : '🔑'}</span>
          <span className="text-xs font-thai">{user ? 'โปรไฟล์' : 'เข้าสู่ระบบ'}</span>
        </NavLink>
      </div>
    </nav>
  )
}
