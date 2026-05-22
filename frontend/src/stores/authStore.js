import { create } from 'zustand'
import { login as apiLogin, getMe } from '../services/api'

function getCachedUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
}

const useAuthStore = create((set) => ({
  user: getCachedUser(),
  token: localStorage.getItem('token') || null,
  loading: false,
  fetchingMe: false,

  login: async (identifier, idType, displayName) => {
    set({ loading: true })
    try {
      const res = await apiLogin({ identifier, id_type: idType, display_name: displayName })
      const { access_token, user } = res.data
      localStorage.setItem('token', access_token)
      localStorage.setItem('user', JSON.stringify(user))
      set({ token: access_token, user, loading: false })
      return { ok: true }
    } catch (e) {
      set({ loading: false })
      return { ok: false, error: e.message }
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null })
  },

  fetchMe: async () => {
    set({ fetchingMe: true })
    if (!navigator.onLine) {
      set({ user: getCachedUser(), fetchingMe: false })
      return
    }
    // ถ้ามี cached user → render ได้เลยโดยไม่ต้องรอ, update ใน background
    const cached = getCachedUser()
    if (cached) set({ user: cached, fetchingMe: false })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await getMe({ signal: controller.signal })
      clearTimeout(timeoutId)
      localStorage.setItem('user', JSON.stringify(res.data))
      set({ user: res.data, fetchingMe: false })
    } catch (e) {
      clearTimeout(timeoutId)
      if (e?.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        set({ user: null, token: null, fetchingMe: false })
      } else {
        // network error / timeout / server down → ใช้ cached user ไม่ลบ token
        set({ user: getCachedUser(), fetchingMe: false })
      }
    }
  },
}))

export default useAuthStore
