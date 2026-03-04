import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import useAuthStore from './stores/authStore'
import BottomNav from './components/BottomNav'
import Search from './pages/Search'
import WordDetail from './pages/WordDetail'
import History from './pages/History'
import Flashcard from './pages/Flashcard'
import Notes from './pages/Notes'
import Login from './pages/Login'
import Profile from './pages/Profile'
import LineCallback from './pages/LineCallback'
import AdminDashboard from './pages/admin/AdminDashboard'
import PendingWords from './pages/admin/PendingWords'
import MissedSearches from './pages/admin/MissedSearches'
import ImportWords from './pages/admin/ImportWords'
import AddWord from './pages/admin/AddWord'
import BulkExamples from './pages/admin/BulkExamples'
import ActivityLog from './pages/admin/ActivityLog'
import Subscriptions from './pages/admin/Subscriptions'

function AdminGuard({ children }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" />
  if (user && !user.is_admin) return <Navigate to="/" />
  return children
}

export default function App() {
  const { token, fetchMe } = useAuthStore()

  useEffect(() => {
    if (token) fetchMe()
  }, [token])

  return (
    <div className="max-w-lg mx-auto min-h-screen">
      <Routes>
        <Route path="/" element={<Search />} />
        <Route path="/word/:id" element={<WordDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="/flashcard" element={<Flashcard />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/login" element={<Login />} />
        <Route path="/line-callback" element={<LineCallback />} />
        <Route path="/profile" element={<Profile />} />
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <AdminDashboard />
            </AdminGuard>
          }
        >
          <Route index element={<Navigate to="/admin/pending" />} />
          <Route path="pending" element={<PendingWords />} />
          <Route path="missed" element={<MissedSearches />} />
          <Route path="import" element={<ImportWords />} />
          <Route path="add" element={<AddWord />} />
          <Route path="examples" element={<BulkExamples />} />
          <Route path="activity" element={<ActivityLog />} />
          <Route path="subscriptions" element={<Subscriptions />} />
        </Route>
      </Routes>
      <BottomNav />
    </div>
  )
}
