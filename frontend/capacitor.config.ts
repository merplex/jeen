import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.jeen.dictionary',
  appName: '字典 Jeen',
  webDir: 'dist',
  server: {
    // Production: ใช้ bundle assets (ไม่มี server URL)
    // Dev: uncomment บรรทัดล่างนี้แล้วใส่ IP เครื่อง
    // url: 'http://192.168.x.x:3000',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#C0392B',
      showSpinner: false,
    },
  },
}

export default config
