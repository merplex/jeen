import { create } from 'zustand'
import { login as apiLogin, getMe } from '../services/api'

const useAuthStore = create((set) => ({
  user: null,
  token: localStorage.getItem('token') || null,
  loading: false,
  fetchingMe: false,

  login: async (identifier, idType, displayName) => {
    set({ loading: true })
    try {
      const res = await apiLogin({ identifier, id_type: idType, display_name: displayName })
      const { access_token, user } = res.data
      localStorage.setItem('token', access_token)
      set({ token: access_token, user, loading: false })
      return { ok: true }
    } catch (e) {
      set({ loading: false })
      return { ok: false, error: e.message }
    }
  },

  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
  },

  fetchMe: async () => {
    set({ fetchingMe: true })
    try {
      const res = await getMe()
      set({ user: res.data, fetchingMe: false })
    } catch {
      localStorage.removeItem('token')
      set({ user: null, token: null, fetchingMe: false })
    }
  },
}))

export default useAuthStore
