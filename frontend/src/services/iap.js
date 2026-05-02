import { registerPlugin, Capacitor } from '@capacitor/core'

// iOS → IAPPlugin.swift, Android → IAPPlugin.java (ลงทะเบียนชื่อเดียวกัน)
const IAPPlugin = registerPlugin('IAP')

const PRODUCT_IDS = {
  learner: 'com.jeen.dictionary.learner_monthly',
  superuser: 'com.jeen.dictionary.superuser_monthly',
}

// 'apple' | 'google'
export function getStorePlatform() {
  return Capacitor.getPlatform() === 'android' ? 'google' : 'apple'
}

export async function purchaseProduct(tier) {
  if (!Capacitor.isNativePlatform()) throw new Error('IAP ไม่พร้อมใช้งาน')
  const productId = PRODUCT_IDS[tier]
  return IAPPlugin.purchase({ productId })
}

export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) return { receipt: '' }
  return IAPPlugin.restorePurchases()
}

export { PRODUCT_IDS }
