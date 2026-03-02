import { useState, useCallback } from 'react'
import { searchWords } from '../services/api'
import WordCard from '../components/WordCard'

const CATEGORIES = ['ทั้งหมด', 'สัตว์', 'แพทย์', 'วิศวกรรม', 'สถานที่', 'กีฬา', 'ทั่วไป']

export default function Search() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState('ทั้งหมด')

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResult(null); return }
    setLoading(true)
    try {
      const res = await searchWords(q.trim())
      setResult(res.data)
    } catch {
      setResult({ prefix_group: [], inner_group: [], found: false, query: q, total: 0 })
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChange = (e) => {
    const v = e.target.value
    setQuery(v)
    doSearch(v)
  }

  const filterByCategory = (words) =>
    category === 'ทั้งหมด' ? words : words.filter((w) => w.category === category)

  const prefix = result ? filterByCategory(result.prefix_group) : []
  const inner = result ? filterByCategory(result.inner_group) : []

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-6">
        <h1 className="font-chinese text-white text-2xl font-bold mb-4 text-center">
          字典 พจนานุกรมจีน-ไทย
        </h1>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={handleChange}
            placeholder="ค้นหาภาษาจีน พินอิน หรือไทย..."
            className="w-full rounded-xl px-4 py-3 pr-10 text-gray-800 bg-white shadow-lg text-base focus:outline-none focus:ring-2 focus:ring-chinese-gold"
            autoFocus
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResult(null) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-hide">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              category === cat
                ? 'bg-chinese-red text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="px-4 space-y-4">
        {loading && (
          <div className="text-center text-gray-400 py-8">กำลังค้นหา...</div>
        )}

        {result && !loading && (
          <>
            {!result.found && (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">🔍</div>
                <p className="text-gray-500">ไม่พบคำว่า "<strong>{result.query}</strong>"</p>
                <p className="text-sm text-gray-400 mt-1">บันทึกไว้ให้ Admin เพิ่มให้นะครับ</p>
              </div>
            )}

            {prefix.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-chinese-gold uppercase tracking-wider mb-2">
                  คำที่ขึ้นต้นด้วย "{result.query}"
                </h2>
                <div className="space-y-2">
                  {prefix.map((w) => <WordCard key={w.id} word={w} />)}
                </div>
              </div>
            )}

            {inner.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  คำที่มี "{result.query}" อยู่ข้างใน
                </h2>
                <div className="space-y-2">
                  {inner.map((w) => <WordCard key={w.id} word={w} />)}
                </div>
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          <div className="text-center py-16 text-gray-400">
            <div className="font-chinese text-6xl text-chinese-red/20 mb-4">字</div>
            <p>พิมพ์คำที่ต้องการค้นหา</p>
            <p className="text-sm mt-1">รองรับ จีน / พินอิน / ไทย</p>
          </div>
        )}
      </div>
    </div>
  )
}
