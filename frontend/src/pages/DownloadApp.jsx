export default function DownloadApp() {
  return (
    <div className="min-h-screen bg-chinese-cream flex flex-col items-center justify-center px-6 text-center">
      <div className="font-chinese text-7xl text-chinese-red mb-4">字典</div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Jeen — พจนานุกรมจีน-ไทย</h1>
      <p className="text-gray-500 mb-8 text-sm leading-relaxed">
        กรุณาใช้งานผ่านแอปพลิเคชันบนมือถือ<br/>
        เพื่อประสบการณ์การใช้งานที่ดีที่สุด
      </p>

      <div className="space-y-3 w-full max-w-xs">
        {/* Android */}
        <a
          href="#"
          className="flex items-center gap-4 bg-gray-900 text-white rounded-2xl px-5 py-4 w-full"
          onClick={(e) => e.preventDefault()}
        >
          <svg className="w-8 h-8 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.523 15.342l-1.395-2.412A5.978 5.978 0 0018 9H6a5.978 5.978 0 001.872 4.342L6.477 15.34A1 1 0 007.35 17h9.3a1 1 0 00.873-1.658zM8.5 5.5a.5.5 0 110-1 .5.5 0 010 1zm7 0a.5.5 0 110-1 .5.5 0 010 1zM4 9a8 8 0 1116 0H4z"/>
          </svg>
          <div className="text-left">
            <div className="text-xs text-gray-400 leading-none">ดาวน์โหลดบน</div>
            <div className="text-base font-semibold leading-tight">Google Play</div>
          </div>
        </a>

        {/* iOS */}
        <a
          href="#"
          className="flex items-center gap-4 bg-gray-900 text-white rounded-2xl px-5 py-4 w-full"
          onClick={(e) => e.preventDefault()}
        >
          <svg className="w-8 h-8 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
          <div className="text-left">
            <div className="text-xs text-gray-400 leading-none">ดาวน์โหลดบน</div>
            <div className="text-base font-semibold leading-tight">App Store</div>
          </div>
        </a>
      </div>

      <p className="text-xs text-gray-300 mt-10">
        เวอร์ชันเว็บสำหรับผู้ดูแลระบบเท่านั้น
      </p>
    </div>
  )
}
