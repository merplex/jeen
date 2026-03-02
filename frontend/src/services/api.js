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

export const searchWords = (q) => api.get('/search', { params: { q } })
export const searchEnglish = (q) => api.get('/search/english', { params: { q } })
export const getWord = (id) => api.get(`/words/${id}`)

export const login = (data) => api.post('/users/login', data)
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
export const adminApprove = (id) => api.post(`/admin/pending/${id}/approve`)
export const adminReject = (id) => api.delete(`/admin/pending/${id}`)
export const adminMissed = () => api.get('/admin/missed-searches')
export const adminImport = (formData) =>
  api.post('/admin/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
export const adminCreateWord = (data) => api.post('/words', data)
export const adminUpdateWord = (id, data) => api.put(`/words/${id}`, data)
export const adminDeleteWord = (id) => api.delete(`/words/${id}`)

export default api
