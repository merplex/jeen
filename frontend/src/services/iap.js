import { registerPlugin, Capacitor } from '@capacitor/core'

// ลงทะเบียน native plugin ที่เขียนเป็น Swift
const IAPPlugin = registerPlugin('IAP')

const PRODUCT_IDS = {
  learner: 'com.jeen.dictionary.learner_monthly',
  superuser: 'com.jeen.dictionary.superuser_monthly',
}

export async function purchaseProduct(tier) {
  if (!Capacitor.isNativePlatform()) throw new Error('IAP ไม่พร้อมใช้งาน')
  const productId = PRODUCT_IDS[tier]
  // IAPPlugin.purchase คืน { productId, receipt } จาก Swift
  return IAPPlugin.purchase({ productId })
}

export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) return { receipt: '' }
  return IAPPlugin.restorePurchases()
}

export { PRODUCT_IDS }
