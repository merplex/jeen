export default function OfflineAlert({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl px-6 py-6 shadow-2xl max-w-xs w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl mb-3">📡</div>
        <h3 className="font-semibold text-gray-800 mb-1">ต้องการอินเทอร์เน็ต</h3>
        <p className="text-sm text-gray-500 mb-4">ฟีเจอร์นี้ต้องการการเชื่อมต่ออินเทอร์เน็ต<br/>กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่</p>
        <button
          onClick={onClose}
          className="w-full bg-chinese-red text-white rounded-xl py-2.5 text-sm font-medium"
        >
          รับทราบ
        </button>
      </div>
    </div>
  )
}
