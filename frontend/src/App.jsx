import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import useAuthStore from './stores/authStore'
import { startFlashcardSync } from './services/flashcardSyncService'
import { startFavoritesSync } from './services/favoritesSyncService'
import { startNotesSync } from './services/notesSyncService'
import BottomNav from './components/BottomNav'
import Search from './pages/Search'
import WordDetail from './pages/WordDetail'
import History from './pages/History'
import Learning from './pages/Learning'
import FlashcardPlay from './pages/FlashcardPlay'
import WritingPractice from './pages/WritingPractice'
import SpeakingPractice from './pages/SpeakingPractice'
import Notes from './pages/Notes'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import LineCallback from './pages/LineCallback'
import AdminDashboard from './pages/admin/AdminDashboard'
import PendingWords from './pages/admin/PendingWords'
import MissedSearches from './pages/admin/MissedSearches'
import ImportWords from './pages/admin/ImportWords'
import AddWord from './pages/admin/AddWord'
import AddWordSection from './pages/admin/AddWordSection'
import BulkExamples from './pages/admin/BulkExamples'
import Subscriptions from './pages/admin/Subscriptions'
import MassTranslation from './pages/admin/MassTranslation'
import OcrLive from './pages/OcrLive'
import DownloadApp from './pages/DownloadApp'
import PrivacyPolicy from './pages/PrivacyPolicy'
import DeleteAccount from './pages/DeleteAccount'

function AdminGuard({ children }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" />
  if (user && !user.is_admin) return <Navigate to="/" />
  return children
}

const isNative = Capacitor.isNativePlatform()

export default function App() {
  const { token, fetchMe, user, fetchingMe } = useAuthStore()

  useEffect(() => {
    if (token) fetchMe()
  }, [token])

  // ดึง user data จาก server มา local ทุกครั้งที่เปิดแอป + ตอน reconnect
  useEffect(() => {
    if (!token) return
    const sync = () => {
      startFlashcardSync(token).catch(() => {})
      startFavoritesSync(token).catch(() => {})
      startNotesSync(token).catch(() => {})
    }
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [token])

  // Privacy policy accessible to everyone (web + native, no login needed)
  if (window.location.pathname === '/privacy') return <PrivacyPolicy />

  // Web browser: รอโหลด user ก่อน แล้วเช็ค is_admin
  if (!isNative) {
    const path = window.location.pathname
    // หน้า login/line-callback เข้าได้เสมอ
    if (path === '/login' || path === '/register' || path === '/line-callback') {
      // render routes ปกติด้านล่าง
    } else {
      // ยังโหลดอยู่ (มี token แต่ยังไม่รู้ว่า admin ไหม) → รอก่อน
      if (token && fetchingMe) {
        return (
          <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
            <div className="text-gray-400 text-sm">กำลังโหลด...</div>
          </div>
        )
      }
      // ยังไม่ login → ไป login
      if (!token) { window.location.replace('/login'); return null }
      // ไม่ใช่ admin → DownloadApp
      if (!user?.is_admin) return <DownloadApp />
    }
  }

  return (
    <div className="max-w-lg mx-auto min-h-screen">
      <Routes>
        <Route path="/" element={<Search />} />
        <Route path="/word/:id" element={<WordDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="/flashcard" element={<Learning />} />
        <Route path="/learning" element={<Learning />} />
        <Route path="/learning/play/:deck" element={<FlashcardPlay />} />
        <Route path="/learning/write/:deck" element={<WritingPractice />} />
        <Route path="/speaking/practice" element={<SpeakingPractice />} />
        <Route path="/ocr/live" element={<OcrLive />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/delete-account" element={<DeleteAccount />} />
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
          <Route index element={<Navigate to="/admin/add/by-word" />} />
          <Route path="add" element={<AddWordSection />}>
            <Route index element={<Navigate to="/admin/add/by-word" />} />
            <Route path="by-word" element={<AddWord />} />
            <Route path="import" element={<ImportWords />} />
            <Route path="pending" element={<PendingWords />} />
          </Route>
          <Route path="missed" element={<MissedSearches />} />
          <Route path="examples" element={<BulkExamples />} />
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="bulkinput" element={<MassTranslation />} />
        </Route>
      </Routes>
      <BottomNav />
    </div>
  )
}
