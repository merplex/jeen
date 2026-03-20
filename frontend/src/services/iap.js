import { Capacitor } from '@capacitor/core'

const PRODUCT_IDS = {
  learner: 'com.jeen.dictionary.learner_monthly',
  superuser: 'com.jeen.dictionary.superuser_monthly',
}

function getStore() {
  return window.CdvPurchase?.store
}

function getIAPPlatform() {
  const { Platform } = window.CdvPurchase ?? {}
  if (!Platform) return null
  const p = Capacitor.getPlatform()
  if (p === 'ios') return Platform.APPLE_APP_STORE
  if (p === 'android') return Platform.GOOGLE_PLAY
  return null
}

export async function initIAP(onPurchaseVerified) {
  if (!Capacitor.isNativePlatform()) return
  // รอให้ CdvPurchase โหลดเสร็จ (inject โดย Cordova bridge)
  await new Promise((resolve) => {
    const check = () => {
      if (window.CdvPurchase) return resolve()
      setTimeout(check, 100)
    }
    check()
  })

  const { store, ProductType } = window.CdvPurchase
  const platform = getIAPPlatform()
  if (!platform) return

  store.register([
    { id: PRODUCT_IDS.learner, type: ProductType.PAID_SUBSCRIPTION, platform },
    { id: PRODUCT_IDS.superuser, type: ProductType.PAID_SUBSCRIPTION, platform },
  ])

  store.when().approved(async (transaction) => {
    try {
      const productId = transaction.products[0]?.id
      const isApple = Capacitor.getPlatform() === 'ios'
      const purchaseToken = isApple
        ? transaction.appStoreReceipt   // base64 receipt
        : transaction.purchaseToken      // Google Play token
      const platformStr = isApple ? 'apple' : 'google'
      await onPurchaseVerified({ platform: platformStr, product_id: productId, purchase_token: purchaseToken })
      await transaction.finish()
    } catch (err) {
      console.error('IAP verify error', err)
    }
  })

  await store.initialize([platform])
}

export async function purchaseProduct(tier) {
  const store = getStore()
  const platform = getIAPPlatform()
  if (!store || !platform) throw new Error('IAP ไม่พร้อมใช้งาน')
  const productId = PRODUCT_IDS[tier]
  const product = store.get(productId, platform)
  if (!product) throw new Error('ไม่พบสินค้า')
  await store.order(product)
}

export async function restorePurchases() {
  const store = getStore()
  if (!store) return
  await store.restorePurchases()
}

export { PRODUCT_IDS }
