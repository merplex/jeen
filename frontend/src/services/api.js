import axios from 'axios'

// Local dev → ใช้ proxy /api → localhost:8000
// Production (Railway/Vercel) → VITE_API_URL ชี้ไปที่ Railway backend
const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: BASE_URL,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // token หมดอายุหรือไม่ valid → ล้าง token แล้ว redirect ไป login
    // ยกเว้น /users/login เพราะ 401 ที่นั่นหมายถึง credential ผิด ไม่ใช่ token หมดอายุ
    if (err.response?.status === 401 && !err.config?.url?.includes('/users/login')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const searchWords = (q) => api.get('/search', { params: { q } })
export const searchEnglish = (q) => api.get('/search/english', { params: { q } })
export const reportMissedSearch = (q) => api.post('/search/report-missed', null, { params: { q } })
export const reportMissedSearchDirect = (q) => api.post('/search/report-missed', null, { params: { q, skip_validate: true } })
export const recordSearchHistory = (q, wordId, found) =>
  api.post('/search/record-history', null, { params: { q, word_id: wordId ?? undefined, found } })
export const getWord = (id) => api.get(`/words/${id}`)

export const login = (data) => api.post('/users/login', data)
export const requestEmailOtp = (email) => api.post('/auth/email/request-otp', { email })
export const verifyEmailOtp = (email, otp) => api.post('/auth/email/verify-otp', { email, otp })
export const getMe = () => api.get('/users/me')
export const getHistory = () => api.get('/users/me/history')
export const deleteHistory = (id) => api.delete(`/users/me/history/${id}`)

export const getFlashcards = () => api.get('/flashcards')
export const addFlashcard = (wordId) => api.post(`/flashcards/${wordId}`)
export const removeFlashcard = (wordId) => api.delete(`/flashcards/${wordId}`)

export const getNotes = (q = '') => api.get('/notes', { params: { q } })
export const createNote = (data) => api.post('/notes', data)
export const updateNote = (id, data) => api.put(`/notes/${id}`, data)
export const deleteNote = (id) => api.delete(`/notes/${id}`)

export const adminGetPending = (skip = 0, limit = 50) =>
  api.get('/admin/pending', { params: { skip, limit } })
export const adminApprove = (id, thaiMeaning = null, pinyin = null, category = null) =>
  api.post(`/admin/pending/${id}/approve`, {
    ...(thaiMeaning && { thai_meaning: thaiMeaning }),
    ...(pinyin && { pinyin }),
    ...(category && { category }),
  })
export const adminReject = (id) => api.delete(`/admin/pending/${id}`)
export const adminMissed = () => api.get('/admin/missed-searches')
export const adminDeleteMissed = (id) => api.delete(`/admin/missed-searches/${id}`)
export const adminClearSingleMissed = () => api.delete('/admin/missed-searches/clear-singles')
export const adminImport = (formData) =>
  api.post('/admin/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const adminCreateWord = (data) => api.post('/words', data)
export const adminUpdateWord = (id, data) => api.put(`/words/${id}`, data)
export const adminDeleteWord = (id) => api.delete(`/words/${id}`)
export const adminGenerateDailyWords = (count, category = null, keyword = null) =>
  api.post('/admin/generate-daily-words', {
    count,
    ...(category && { category }),
    ...(keyword && { keyword }),
  })
export const adminImportWords = (words) =>
  api.post('/admin/import-words', { words })
export const adminGenerateExamples = (id) =>
  api.post(`/admin/generate-examples/${id}`)
export const adminExamplesStats = () =>
  api.get('/admin/examples-stats')
export const adminWipeAllExamples = () =>
  api.delete('/admin/wipe-all-examples')
export const adminBulkGenerateExamples = (limit = 30) =>
  api.post('/admin/bulk-generate-examples', null, { params: { limit } })
export const adminEnglishStats = () =>
  api.get('/admin/english-stats')
export const adminBulkGenerateEnglish = (limit = 50) =>
  api.post('/admin/bulk-generate-english', null, { params: { limit } })
export const adminActivityLog = (limit = 50) =>
  api.get('/admin/activity-log', { params: { limit } })

export default api
