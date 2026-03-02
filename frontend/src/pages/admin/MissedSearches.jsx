import { useEffect, useState } from 'react'
import { adminMissed } from '../../services/api'

export default function MissedSearches() {
  const [items, setItems] = useState([])

  useEffect(() => { adminMissed().then((r) => setItems(r.data)) }, [])

  return (
    <div className="px-4 py-4">
      <p className="text-sm text-gray-500 mb-4">{items.length} คำที่ค้นแล้วไม่พบ</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="bg-white rounded-xl px-4 py-3 shadow-sm flex justify-between items-center">
            <div>
              <div className="font-medium text-gray-800">{item.query}</div>
              <div className="text-xs text-gray-400">
                ค้นหาล่าสุด: {new Date(item.last_searched_at).toLocaleString('th-TH')}
              </div>
            </div>
            <div className="bg-chinese-red text-white text-sm font-bold px-3 py-1 rounded-full">
              {item.count}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-center text-gray-400 py-12">ยังไม่มีคำที่ค้นไม่พบ</div>
        )}
      </div>
    </div>
  )
}
