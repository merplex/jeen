export default function TtsSettingsAlert({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl px-6 py-8 shadow-2xl max-w-xs w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-4">🔊</div>
        <p className="text-gray-800 font-semibold text-base mb-2">ไม่พบเสียงภาษาจีน</p>
        <p className="text-gray-500 text-sm mb-6 leading-relaxed">
          ไปที่ Settings → Accessibility → Text-to-speech<br />
          → Google TTS Engine → Language → ดาวน์โหลด<br />
          <span className="font-medium">Chinese (Mandarin)</span>
        </p>
        <button
          onClick={onClose}
          className="w-full bg-chinese-red text-white rounded-xl py-3 text-sm font-medium"
        >
          ตกลง
        </button>
      </div>
    </div>
  )
}
