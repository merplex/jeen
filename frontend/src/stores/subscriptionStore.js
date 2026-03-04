import { create } from 'zustand'
import { getSubscriptionStatus } from '../services/api'

const useSubscriptionStore = create((set, get) => ({
  subscription: null,   // null = ยังไม่ได้ fetch
  loading: false,

  fetch: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await getSubscriptionStatus()
      set({ subscription: res.data, loading: false })
    } catch {
      // ถ้า error (เช่น ยังไม่ login) → ถือว่าไม่มี subscription
      set({ subscription: { active: false }, loading: false })
    }
  },

  // Helper: ใช้งาน app ได้ปกติไหม?
  // ตอนนี้ทุก user ใช้ได้ (free tier) — อนาคตเปลี่ยน logic ตรงนี้
  canUse: () => true,

  reset: () => set({ subscription: null }),
}))

export default useSubscriptionStore
