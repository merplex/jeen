export default function OfflineAlert({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl px-6 py-8 shadow-2xl max-w-xs w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-5xl mb-4">🌐</div>
        <p className="text-gray-800 font-semibold text-base mb-6">กรุณาเชื่อมต่ออินเตอร์เน็ต</p>
        <button
          onClick={onClose}
          className="w-full bg-blue-500 text-white rounded-xl py-3 text-sm font-medium"
        >
          ปิด
        </button>
      </div>
    </div>
  )
}
