import { useState, useEffect } from 'react'
import { CATEGORIES } from '../../utils/categories'
import { adminGetSettings, adminUpdateSettings, adminGetCategoryWords, adminUpdateWord } from '../../services/api'

const GRID_CFG_KEY = 'admin_grid_config'
function loadCachedGridConfig() {
  try { return JSON.parse(localStorage.getItem(GRID_CFG_KEY) || '{}') } catch { return {} }
}
function saveGridConfigCache(cfg) {
  try { localStorage.setItem(GRID_CFG_KEY, JSON.stringify(cfg)) } catch { /* ignore */ }
}

export default function CategoryImageConfig() {
  const [gridConfig, setGridConfig] = useState(loadCachedGridConfig)  // load instantly from cache
  const [selectedCat, setSelectedCat] = useState(null)
  const [words, setWords] = useState([])
  const [loadingWords, setLoadingWords] = useState(false)
  const [imageEdits, setImageEdits] = useState({})  // { wordId: url }
  const [saving, setSaving] = useState({})
  const [settingsSaving, setSettingsSaving] = useState(false)

  useEffect(() => {
    adminGetSettings().then(res => {
      const cfg = res.data?.category_grid_config
      if (cfg && typeof cfg === 'object') {
        setGridConfig(cfg)
        saveGridConfigCache(cfg)
      }
    }).catch(() => {})
  }, [])

  const toggleGrid = async (cat) => {
    const next = { ...gridConfig, [cat]: !gridConfig[cat] }
    setGridConfig(next)
    saveGridConfigCache(next)  // บันทึก cache ทันทีก่อน save backend
    setSettingsSaving(true)
    try {
      await adminUpdateSettings({ category_grid_config: next })
    } catch { /* ignore */ }
    setSettingsSaving(false)
  }

  const loadCategoryWords = (cat) => {
    setSelectedCat(cat)
    setWords([])
    setImageEdits({})
    setLoadingWords(true)
    adminGetCategoryWords(cat)
      .then(res => setWords(res.data))
      .catch(() => {})
      .finally(() => setLoadingWords(false))
  }

  const saveImageUrl = async (wordId) => {
    const url = imageEdits[wordId] ?? ''
    setSaving(prev => ({ ...prev, [wordId]: true }))
    try {
      await adminUpdateWord(wordId, { image_url: url || null })
      setWords(prev => prev.map(w => w.id === wordId ? { ...w, image_url: url || null } : w))
      setImageEdits(prev => { const n = { ...prev }; delete n[wordId]; return n })
    } catch { /* ignore */ }
    setSaving(prev => { const n = { ...prev }; delete n[wordId]; return n })
  }

  return (
    <div className="px-4 py-6 space-y-4">
      {/* Grid toggle per category */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-700">โหมด Grid ต่อหมวด</span>
          {settingsSaving && <span className="text-xs text-gray-400">กำลังบันทึก...</span>}
        </div>
        <p className="text-xs text-gray-400 mb-3">
          เปิด = ผู้ใช้เห็นรูป+ศัพท์แบบ Grid เมื่อกดเลือกหมวดนั้น (ต้องมีรูปสักคำ)
        </p>
        <div className="space-y-2">
          {CATEGORIES.map(cat => (
            <div
              key={cat}
              className="flex items-center justify-between py-1.5 border-b border-gray-50"
            >
              <button
                onClick={() => loadCategoryWords(cat)}
                className={`text-sm font-medium ${selectedCat === cat ? 'text-chinese-red' : 'text-gray-700'}`}
              >
                {cat}
              </button>
              <button
                onClick={() => toggleGrid(cat)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  gridConfig[cat] ? 'bg-chinese-red' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    gridConfig[cat] ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Word list for selected category */}
      {selectedCat && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">
              รูปประกอบ — {selectedCat}
            </span>
            {gridConfig[selectedCat] && (
              <span className="text-xs bg-chinese-red text-white px-2 py-0.5 rounded-full">Grid เปิดอยู่</span>
            )}
          </div>

          {loadingWords ? (
            <div className="py-8 text-center text-gray-400 text-sm">กำลังโหลด...</div>
          ) : words.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">ไม่พบคำในหมวดนี้</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {words.map(w => {
                const editUrl = imageEdits[w.id] !== undefined ? imageEdits[w.id] : (w.image_url ?? '')
                const isDirty = imageEdits[w.id] !== undefined
                return (
                  <div key={w.id} className="px-4 py-3 flex items-start gap-3">
                    {/* Preview */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                      {editUrl ? (
                        <img
                          src={editUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-lg">📷</div>
                      )}
                    </div>

                    {/* Word info + URL input */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="font-chinese text-base text-gray-800">{w.chinese}</span>
                        <span className="text-xs text-gray-400">{w.pinyin}</span>
                      </div>
                      <div className="text-xs text-gray-500 mb-1.5 truncate">
                        {w.thai_meaning?.split('\n')[0]}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="url"
                          value={editUrl}
                          onChange={e => setImageEdits(prev => ({ ...prev, [w.id]: e.target.value }))}
                          placeholder="URL รูปภาพ..."
                          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-chinese-red min-w-0"
                        />
                        {isDirty && (
                          <button
                            onClick={() => saveImageUrl(w.id)}
                            disabled={saving[w.id]}
                            className="text-xs px-2 py-1 bg-chinese-red text-white rounded disabled:opacity-50 shrink-0"
                          >
                            {saving[w.id] ? '...' : 'Save'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
