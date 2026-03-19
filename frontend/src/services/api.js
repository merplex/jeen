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
export const getRandomWords = (limit = 30, category = null) =>
  api.get('/words/random', { params: { limit, ...(category && category !== 'ทั้งหมด' ? { category } : {}) } })

export const login = (data) => api.post('/users/login', data)
export const requestEmailOtp = (email) => api.post('/auth/email/request-otp', { email })
export const verifyEmailOtp = (email, otp) => api.post('/auth/email/verify-otp', { email, otp })
export const emailSetPassword = (email, password, verify_token) => api.post('/auth/email/set-password', { email, password, verify_token })
export const emailLogin = (email, password) => api.post('/auth/email/login', { email, password })
export const deleteAccount = () => api.delete('/auth/account')
export const getMe = () => api.get('/users/me')
export const getHistory = () => api.get('/users/me/history')
export const deleteHistory = (id) => api.delete(`/users/me/history/${id}`)

export const getFlashcards = (deck = null) =>
  api.get('/flashcards', { params: deck ? { deck } : {} })
export const getFlashcardDecks = (wordId) => api.get(`/flashcards/word/${wordId}`)
export const getFlashcardStats = () => api.get('/flashcards/stats')
export const addFlashcard = (wordId, deck = 1) =>
  api.post(`/flashcards/${wordId}`, null, { params: { deck } })
export const removeFlashcard = (wordId, deck = 1) =>
  api.delete(`/flashcards/${wordId}`, { params: { deck } })

export const getSpeakingHistory = () => api.get('/speaking/history')
export const getSpeakingDailyStatus = () => api.get('/speaking/daily-status')
export const assessSpeaking = (data) => api.post('/speaking/assess', data)
export const generateSpeakingSentences = (data) => api.post('/speaking/generate-sentences', data)

export const getNotes = (q = '') => api.get('/notes', { params: { q } })
export const createNote = (data) => api.post('/notes', data)
export const updateNote = (id, data) => api.put(`/notes/${id}`, data)
export const deleteNote = (id) => api.delete(`/notes/${id}`)

export const adminGetWords = (hsk_level = null) =>
  api.get('/admin/words', { params: { ...(hsk_level ? { hsk_level } : {}) } })

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
export const adminUploadWordImage = (wordId, file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post(`/words/${wordId}/image/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
}
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
export const adminGenerateRelated = (id) =>
  api.post(`/admin/generate-related/${id}`)
export const adminRegenerateEnglish = (id) =>
  api.post(`/admin/regenerate-english/${id}`)
export const adminExamplesStats = () =>
  api.get('/admin/examples-stats')
export const adminWipeAllExamples = () =>
  api.delete('/admin/wipe-all-examples')
export const adminBulkGenerateExamples = (limit = 30) =>
  api.post('/admin/bulk-generate-examples', null, { params: { limit } })
export const adminBulkQueueExamples = () =>
  api.post('/admin/bulk-queue-examples')
export const adminCategoryWordCounts = () =>
  api.get('/admin/category-word-counts')
export const adminRegenExamplesByCategory = (category, limit = 20, offset = 0, hsk_level = null) =>
  api.post('/admin/regen-examples-by-category', null, { params: { ...(hsk_level ? { hsk_level } : { category }), limit, offset } })
export const adminRegenEnglishByCategory = (category, hsk_level, limit = 100, offset = 0) =>
  api.post('/admin/regen-english-by-category', null, { params: { ...(hsk_level ? { hsk_level } : { category }), limit, offset } })
export const adminBulkRegenShortExamples = (limit = 30, min_length = 10) =>
  api.post('/admin/bulk-regen-short-examples', null, { params: { limit, min_length } })
export const adminEnglishStats = () =>
  api.get('/admin/english-stats')
export const adminBulkGenerateEnglish = (limit = 500) =>
  api.post('/admin/bulk-generate-english', null, { params: { limit } })
export const adminFixLongEnglish = (maxLen = 100) =>
  api.get('/admin/fix-long-english', { params: { max_len: maxLen } })
export const adminSingleEnglishStats = (category = null) =>
  api.get('/admin/single-english-stats', { params: { ...(category ? { category } : {}) } })
export const adminBulkRegenSingleEnglish = (limit = 50, category = null) =>
  api.post('/admin/bulk-regen-single-english', null, { params: { limit, ...(category ? { category } : {}) } })
export const adminHskEnglishStats = () =>
  api.get('/admin/hsk-english-stats')
export const adminStartHskEnglishQueue = () =>
  api.post('/admin/start-hsk-english-queue')
export const adminStopHskEnglishQueue = () =>
  api.post('/admin/stop-hsk-english-queue')
export const adminActivityLog = (limit = 50) =>
  api.get('/admin/activity-log', { params: { limit } })
export const adminGetSettings = () => api.get('/admin/settings')
export const adminUpdateSettings = (data) => api.put('/admin/settings', data)

// Public settings (no auth)
export const getPublicSettings = () => api.get('/words/public-settings')
export const getWordImage = (wordId) => api.get(`/words/${wordId}/image`)
export const refreshWordImage = (wordId) => api.post(`/words/${wordId}/image/refresh`)
export const uploadWordImage = (wordId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/words/${wordId}/image/upload`, form)
}

// Favorites
export const getFavorites = () => api.get('/words/favorites')
export const toggleFavorite = (wordId) => api.post(`/words/${wordId}/favorite`)
export const getFavoriteStatus = (wordId) => api.get(`/words/${wordId}/favorite-status`)

export const adminGetCategoryWords = (category) =>
  api.get('/admin/category-words', { params: { category } })

// Admin image cache
export const adminDeleteImageCache = (category) => api.delete('/admin/image-cache', { params: { category } })
export const adminDeleteNullImageCache = () => api.delete('/admin/image-cache/null')
export const adminDeleteAllImageCache = (excludeCategories = []) =>
  api.delete('/admin/image-cache/all', { params: { exclude_categories: excludeCategories.join(',') } })

// Word reports
export const reportWord = (wordId, message) => api.post(`/words/${wordId}/report`, { message })
export const adminGetWordReports = () => api.get('/admin/word-reports')
export const adminDeleteWordReport = (id) => api.delete(`/admin/word-reports/${id}`)
export const adminGetFlaggedUsers = () => api.get('/admin/flagged-users')
export const adminUnflagUser = (userId) => api.post(`/admin/users/${userId}/unflag`)

// Handwriting
export const recognizeHandwriting = (data) => api.post('/handwriting/recognize', data)

// OCR
export const scanOcr = (data) => api.post('/ocr/scan', data)
export const scanOcrStructured = (data) => api.post('/ocr/scan-structured', data)

// Subscription
export const getSubscriptionStatus = () => api.get('/subscription/status')
export const adminListSubscriptions = () => api.get('/admin/subscription/list')
export const adminGrantSubscription = (data) => api.post('/admin/subscription/grant', data)
export const adminCancelSubscription = (id) => api.patch(`/admin/subscription/${id}/cancel`)

// Tier management
export const adminSetUserTier = (data) => api.post('/admin/users/set-tier', data)
export const adminListTieredUsers = () => api.get('/admin/users/tiered')

// System status
export const adminGeminiQuota = () => api.get('/admin/gemini-quota')
export const adminImageStorage = () => api.get('/admin/image-storage')

export default api
