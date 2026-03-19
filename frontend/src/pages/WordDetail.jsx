import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getWord, addFlashcard, removeFlashcard, getFlashcardDecks, getNotes, createNote, updateNote, adminUpdateWord, adminGenerateExamples, adminGenerateRelated, adminRegenerateEnglish, recordSearchHistory, reportWord, adminDeleteWordReport, getPublicSettings, getWordImage, refreshWordImage, uploadWordImage, getFavoriteStatus, toggleFavorite, reportMissedSearchDirect } from '../services/api'
import useAuthStore from '../stores/authStore'
import useSubscriptionStore from '../stores/subscriptionStore'
import SelectionPopup from '../components/SelectionPopup'
import TonedChinese from '../components/TonedChinese'

const DECK_STYLE = {
  1: { active: 'bg-chinese-red border-chinese-red text-white', inactive: 'bg-transparent border-chinese-red text-chinese-red' },
  2: { active: 'bg-blue-500 border-blue-500 text-white', inactive: 'bg-transparent border-blue-500 text-blue-500' },
  3: { active: 'bg-green-500 border-green-500 text-white', inactive: 'bg-transparent border-green-500 text-green-500' },
}

export default function WordDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, token, fetchingMe } = useAuthStore()
  const { subscription, fetch: fetchSub } = useSubscriptionStore()
  const [word, setWord] = useState(null)
  const [activeDecks, setActiveDecks] = useState(new Set()) // deck numbers ที่คำนี้อยู่
  const [note, setNote] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [editData, setEditData] = useState(null) // null = ไม่ได้ edit
  const [editSaving, setEditSaving] = useState(false)
  const [genExLoading, setGenExLoading] = useState(false)
  const [genRelatedLoading, setGenRelatedLoading] = useState(false)
  const [genEngLoading, setGenEngLoading] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [reportSending, setReportSending] = useState(false)

  // context จาก admin "เช็ค" — { reportId, reportMsg, reportUserName }
  const reportContext = location.state?.reportId ? location.state : null

  const canReport = user?.is_admin || ['learner', 'lifetime', 'superuser'].includes(subscription?.tier)
  const [imageCategories, setImageCategories] = useState([])
  const [wordImageUrl, setWordImageUrl] = useState(undefined) // undefined=ยังไม่โหลด, null=ไม่มีรูป
  const [favorited, setFavorited] = useState(false)
  const [imagePopupOpen, setImagePopupOpen] = useState(false)
  const [imageRefreshing, setImageRefreshing] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)

  // redirect ถ้าไม่มี token
  useEffect(() => {
    if (!token && !fetchingMe) navigate('/login', { replace: true })
  }, [token, fetchingMe, navigate])

  useEffect(() => {
    if (token && !subscription) fetchSub()
  }, [token])

  // โหลด image categories settings (ครั้งเดียวต่อ session)
  useEffect(() => {
    getPublicSettings().then((r) => setImageCategories(r.data.image_categories || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!token) return
    getWord(id)
      .then((r) => {
        setWord(r.data)
        if (user) {
          recordSearchHistory(r.data.chinese, Number(id), true).catch(() => {})
        }
      })
      .catch(() => navigate('/'))
    if (user) {
      getFlashcardDecks(id).then((r) => {
        setActiveDecks(new Set(r.data.decks))
      })
      getNotes().then((r) => {
        const n = r.data.find((n) => n.word_id === Number(id))
        if (n) { setNote(n); setNoteText(n.note_text) }
      })
    }
  }, [id, user])

  // โหลด favorite status
  useEffect(() => {
    if (!user || !word) return
    getFavoriteStatus(word.id).then((r) => setFavorited(r.data.favorited)).catch(() => {})
  }, [user, word?.id])

  // โหลดรูปภาพเมื่อ word โหลดแล้ว
  // admin: โหลดทุก category, user ทั่วไป: เฉพาะ category ที่ตั้งไว้
  useEffect(() => {
    if (!word) return
    const isAdmin = user?.is_admin
    if (!isAdmin && (imageCategories.length === 0 || !word.category || !imageCategories.includes(word.category))) return
    setWordImageUrl(undefined)
    getWordImage(word.id)
      .then((r) => {
        let url = r.data.url || null
        if (url && url.startsWith('/')) {
          const base = import.meta.env.VITE_API_URL || '/api'
          url = base + url
        }
        setWordImageUrl(url)
      })
      .catch(() => setWordImageUrl(null))
  }, [word?.id, imageCategories, user?.is_admin])

  const toggleDeck = async (deck) => {
    if (!user) return navigate('/login')
    if (activeDecks.has(deck)) {
      await removeFlashcard(id, deck)
      setActiveDecks((prev) => { const s = new Set(prev); s.delete(deck); return s })
    } else {
      try {
        await addFlashcard(id, deck)
        setActiveDecks((prev) => new Set([...prev, deck]))
      } catch (e) {
        alert(e.response?.data?.detail || 'ไม่สามารถเพิ่มได้')
      }
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    if (note) {
      const r = await updateNote(note.id, { note_text: noteText })
      setNote(r.data)
    } else {
      const r = await createNote({ word_id: Number(id), note_text: noteText })
      setNote(r.data)
    }
    setEditingNote(false)
  }

  const startEdit = () => {
    setEditData({
      pinyin: word.pinyin || '',
      thai_meaning: word.thai_meaning || '',
      english_meaning: word.english_meaning || '',
      category: word.category || '',
    })
  }

  const saveEdit = async () => {
    setEditSaving(true)
    try {
      const payload = {
        pinyin: editData.pinyin || undefined,
        thai_meaning: editData.thai_meaning || undefined,
        english_meaning: editData.english_meaning || null,
        category: editData.category || null,
      }
      const r = await adminUpdateWord(id, payload)
      setWord(r.data)
      setEditData(null)
      // ถ้าเข้ามาจากหน้า admin "เช็ค" รายงาน → ลบ report แล้วกลับไป
      if (reportContext?.reportId) {
        await adminDeleteWordReport(reportContext.reportId).catch(() => {})
        navigate(-1)
      }
    } catch (e) {
      alert(e.response?.data?.detail || 'บันทึกไม่สำเร็จ')
    }
    setEditSaving(false)
  }

  const sendReport = async () => {
    if (reportMsg.trim().length < 3) return
    setReportSending(true)
    try {
      await reportWord(id, reportMsg.trim())
      setShowReportModal(false)
      setReportMsg('')
      alert('ส่งรายงานแล้ว ขอบคุณครับ')
    } catch (e) {
      alert(e.response?.data?.detail || 'ส่งรายงานไม่สำเร็จ')
    }
    setReportSending(false)
  }

  const generateExamples = async () => {
    setGenExLoading(true)
    try {
      const r = await adminGenerateExamples(id)
      setWord(r.data)
    } catch (e) {
      alert(e.response?.data?.detail || 'สร้างตัวอย่างไม่สำเร็จ')
    }
    setGenExLoading(false)
  }

  const generateRelated = async () => {
    setGenRelatedLoading(true)
    try {
      const r = await adminGenerateRelated(id)
      setWord(r.data)
    } catch (e) {
      alert(e.response?.data?.detail || 'สร้างคำที่เกี่ยวข้องไม่สำเร็จ')
    }
    setGenRelatedLoading(false)
  }

  const generateEnglish = async () => {
    setGenEngLoading(true)
    try {
      const r = await adminRegenerateEnglish(id)
      setWord(r.data)
    } catch (e) {
      alert(e.response?.data?.detail || 'หาคำอังกฤษไม่สำเร็จ')
    }
    setGenEngLoading(false)
  }

  const handleRefreshImage = async (e) => {
    e.stopPropagation()
    if (imageRefreshing) return
    setImageRefreshing(true)
    setWordImageUrl(undefined)
    try {
      const r = await refreshWordImage(word.id)
      let url = r.data.url || null
      if (url && url.startsWith('/api/')) {
        const base = import.meta.env.VITE_API_URL || ''
        url = base + url
      }
      setWordImageUrl(url)
    } catch {
      setWordImageUrl(null)
    }
    setImageRefreshing(false)
  }

  const handleUploadImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUploading(true)
    setWordImageUrl(undefined)
    try {
      const r = await uploadWordImage(word.id, file)
      let url = r.data.url || null
      if (url && url.startsWith('/')) {
        const base = import.meta.env.VITE_API_URL || '/api'
        url = base + url
      }
      setWordImageUrl(url)
    } catch {
      setWordImageUrl(null)
      alert('อัปโหลดรูปไม่สำเร็จ')
    }
    setImageUploading(false)
    e.target.value = ''
  }

  const speak = (text) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  const highlightInText = (text, keyword, className = '') => {
    if (!text || !keyword) return <span className={className}>{text}</span>
    const parts = keyword.split(/[\n;,]/).map(k => k.replace(/\(.*?\)/g, '').trim()).filter(Boolean)
    for (const kw of parts) {
      const idx = text.indexOf(kw)
      if (idx !== -1) {
        return (
          <span className={className}>
            {text.slice(0, idx)}
            <span className="font-bold text-chinese-red">{text.slice(idx, idx + kw.length)}</span>
            {text.slice(idx + kw.length)}
          </span>
        )
      }
    }
    return <span className={className}>{text}</span>
  }

  if (!word) return (
    <div className="flex items-center justify-center min-h-screen bg-chinese-cream">
      <div className="text-gray-400">กำลังโหลด...</div>
    </div>
  )

  const getExampleLabel = (type) => {
    if (!type) return ''
    if (type === 'formal' || type === 'written') return 'บทความ/หนังสือ'
    if (type === 'formal_0') return 'บทความ/หนังสือ 1'
    if (type === 'formal_1') return 'บทความ/หนังสือ 2'
    if (type.startsWith('conv_')) return `สนทนา ${parseInt(type.slice(5), 10) + 1}`
    // legacy
    const legacy = { daily_1: 'ชีวิตประจำวัน 1', daily_2: 'ชีวิตประจำวัน 2', common: 'ทั่วไป', spoken: 'พูด' }
    return legacy[type] || type
  }

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      <SelectionPopup />
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-5">
        {/* Nav row */}
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => navigate(-1)} className="text-white text-2xl">←</button>
          <div className="flex items-center gap-2">
            {canReport && (
              <button
                onClick={() => setShowReportModal(true)}
                title="รายงานปัญหาคำศัพท์"
                className="text-yellow-300 text-xl leading-none"
              >
                ⚠️
              </button>
            )}
            {user && (
              <button
                onClick={async () => {
                  const r = await toggleFavorite(word.id)
                  setFavorited(r.data.favorited)
                }}
                title={favorited ? 'ลบจากคำโปรด' : 'เพิ่มในคำโปรด'}
                className={`text-2xl leading-none flex items-center ${!favorited ? 'opacity-30' : ''}`}
              >
                ⭐
              </button>
            )}
            <button onClick={() => speak(word.chinese)} className="text-white text-2xl" title="ออกเสียง">
              🔊
            </button>
          </div>
        </div>
        {/* White card — คำศัพท์ */}
        <div className="bg-white rounded-xl px-4 py-3 mb-4">
          <div className="text-center leading-tight [word-break:break-all]">
            <TonedChinese
              chinese={word.chinese}
              pinyin={word.pinyin}
              className="font-chinese text-5xl"
            />
          </div>
          <div className="text-chinese-gold text-base text-center mt-1">{word.pinyin}</div>
        </div>

        {/* Flashcard deck buttons */}
        {user && (
          <div className="flex gap-2">
            {[1, 2, 3].map((deck) => {
              const inDeck = activeDecks.has(deck)
              const locked = deck > 1 && !user?.is_admin
              return (
                <button
                  key={deck}
                  onClick={() => !locked && toggleDeck(deck)}
                  className={`flex-1 py-2 text-sm font-semibold rounded transition-all
                    ${inDeck
                      ? 'bg-white/10 border-2 border-white text-white underline underline-offset-2'
                      : 'bg-transparent border-2 border-white/50 text-white/80'
                    }
                    ${locked ? 'opacity-40' : 'active:scale-95 active:border-[3px]'}`}
                >
                  {locked ? '🔒 ' : ''}Flash card {deck}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-6 space-y-4">
        {/* Meanings */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {word.hsk_level && (
              <span className="text-xs bg-chinese-red text-white px-2 py-0.5 rounded-full">
                {word.hsk_level}
              </span>
            )}
            {word.category && (
              <span className="text-xs bg-chinese-gold/20 text-chinese-gold px-2 py-0.5 rounded-full">
                {word.category}
              </span>
            )}
            {user?.is_admin && word.source === 'ai_daily' && (
              <span className="text-[10px] bg-orange-100 text-orange-500 px-1.5 py-0.5 rounded-full font-medium">🤖 AI</span>
            )}
            {user?.is_admin && word.source === 'import' && (
              <span className="text-[10px] bg-blue-100 text-blue-500 px-1.5 py-0.5 rounded-full font-medium">📥 นำเข้า</span>
            )}
            {user?.is_admin && word.admin_edited && (
              <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-medium">✓ แก้แล้ว</span>
            )}
          </div>
          {/* layout: ถ้ามีรูป (หรือ admin) → 2/3 text + 1/3 image, ถ้าไม่มี → full width */}
          {(() => {
            const isAdmin = user?.is_admin
            const showImageSection = isAdmin || (word.category && imageCategories.includes(word.category))
            const textContent = (
              <>
                <div className="mb-3">
                  <div className="text-xs text-gray-400 mb-1">ภาษาไทย</div>
                  <div className="text-gray-800 text-base space-y-1">
                    {word.thai_meaning.split('\n').filter((l) => l.trim()).map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
                {(word.english_meaning || user?.is_admin) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-gray-400">English</div>
                      {user?.is_admin && (
                        <button
                          onClick={generateEnglish}
                          disabled={genEngLoading}
                          className="text-xs text-chinese-red disabled:opacity-50"
                        >
                          {genEngLoading ? '⏳ กำลังหา...' : word.english_meaning ? '🔄 หาใหม่' : '✨ หาคำอังกฤษ'}
                        </button>
                      )}
                    </div>
                    {word.english_meaning && <div className="text-gray-600">{word.english_meaning}</div>}
                  </div>
                )}
              </>
            )
            if (!showImageSection) return textContent
            return (
              <div className="flex gap-3 items-start">
                <div className="flex-1 min-w-0">{textContent}</div>
                <div className="w-1/3 flex-shrink-0">
                  {wordImageUrl === undefined || imageUploading ? (
                    <div className="w-full aspect-square rounded-lg bg-gray-100 animate-pulse" />
                  ) : wordImageUrl ? (
                    <div className="relative">
                      <img
                        src={wordImageUrl}
                        alt={word.chinese}
                        className="w-full aspect-square object-cover rounded-lg cursor-pointer"
                        onClick={() => setImagePopupOpen(true)}
                        onError={() => setWordImageUrl(null)}
                      />
                      {isAdmin && (
                        <label className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded-md leading-none cursor-pointer" title="เปลี่ยนรูป">
                          📷
                          <input type="file" accept="image/*" className="hidden" onChange={handleUploadImage} />
                        </label>
                      )}
                    </div>
                  ) : isAdmin ? (
                    <label className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-chinese-red transition-colors">
                      <span className="text-2xl">📷</span>
                      <span className="text-xs text-gray-400 mt-1">เพิ่มรูป</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleUploadImage} />
                    </label>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Related Words — เฉพาะคำ 2 อักษร หรือสำนวน 4+ อักษร */}
        {(word.chinese.length === 2 || word.chinese.length >= 4) && (word.related_words || user?.is_admin) && (() => {
          const rw = word.related_words
          const isIdiom = word.chinese.length >= 4
          const groups = isIdiom
            ? [
                { key: 'similar', label: 'ความหมายใกล้เคียง' },
                { key: 'opposite', label: 'ความหมายตรงข้าม' },
              ]
            : [
                { key: 'similar', label: 'คำคล้าย' },
                { key: 'opposite', label: 'คำตรงข้าม' },
                { key: 'collocations', label: 'คำข้างเคียง' },
              ]

          const handleRelatedWordClick = async (item) => {
            if (item.word_id) {
              navigate(`/words/${item.word_id}`)
            } else if (user?.is_admin) {
              // เพิ่มเข้า missed searches แล้วไปหน้า ค้นไม่พบ
              try { await reportMissedSearchDirect(item.chinese) } catch {}
              navigate('/admin/missed')
            }
            // user ทั่วไป + ไม่มีใน DB → ไม่ทำอะไร
          }

          return (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-500">คำที่เกี่ยวข้อง</h3>
                {user?.is_admin && (
                  <button
                    onClick={generateRelated}
                    disabled={genRelatedLoading}
                    className="text-xs text-chinese-red disabled:opacity-50"
                  >
                    {genRelatedLoading ? '⏳ กำลังสร้าง...' : rw ? '🔄 สร้างใหม่' : '✨ สร้างคำเกี่ยวข้อง'}
                  </button>
                )}
              </div>
              {!rw ? (
                <p className="text-xs text-gray-400 text-center py-2">ยังไม่มีข้อมูล — กด ✨ สร้างคำเกี่ยวข้อง</p>
              ) : (
                <div className={`grid gap-2 ${isIdiom ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {groups.map(({ key, label }) => {
                    const items = (rw[key] || []).slice(0, 2)
                    if (items.length === 0) return null
                    return (
                      <div key={key}>
                        <div className="text-[10px] text-gray-400 font-medium mb-1.5 text-center">{label}</div>
                        {/* กล่องเดียว มี 2 คำเคียงกัน แบ่งด้วยเส้นแนวตั้ง */}
                        <div className="flex bg-chinese-cream rounded-lg overflow-hidden">
                          {items.map((item, i) => {
                            const inDb = !!item.word_id
                            const clickable = inDb || user?.is_admin
                            return (
                              <div key={i} className="flex-1 flex">
                                {i > 0 && <div className="w-px bg-gray-300 flex-shrink-0" />}
                                <button
                                  onClick={() => handleRelatedWordClick(item)}
                                  disabled={!clickable}
                                  className={`flex-1 py-2 transition-colors
                                    ${clickable ? 'active:bg-chinese-gold/20' : 'opacity-40 cursor-default'}`}
                                >
                                  <div className="font-chinese text-base text-gray-800 leading-tight text-center">{item.chinese}</div>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* Examples */}
        {(word.examples?.length > 0 || user?.is_admin || word.source === 'juhe_dataset') && (() => {
          const isJuheOnly = word.source === 'juhe_dataset'
          return (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500">ประโยคตัวอย่าง</h3>
              {user?.is_admin && !isJuheOnly && (
                <button
                  onClick={generateExamples}
                  disabled={genExLoading}
                  className="text-xs text-chinese-red disabled:opacity-50"
                >
                  {genExLoading ? '⏳ กำลังสร้าง...' : word.examples?.length > 0 ? '🔄 สุ่มใหม่' : '✨ สร้างตัวอย่าง'}
                </button>
              )}
            </div>
            {isJuheOnly ? (
              <p className="text-xs text-gray-400 leading-relaxed py-1">
                รูปอ้างอิงจาก{' '}
                <a
                  href={`https://baike.baidu.com/item/${word.chinese}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-gray-500"
                >
                  百度百科
                </a>
                {' '}และ{' '}
                <a
                  href={`https://home.meishichina.com/search/${word.chinese}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-gray-500"
                >
                  美食天下
                </a>
                {' '}อาหารสำเร็จรูปปกติจะต่างออกไปในแต่ละร้านอาหาร โปรดดูด้วยวิจารณญาน
              </p>
            ) : word.examples?.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">
                {user?.is_admin ? 'ยังไม่มีตัวอย่าง — กด ✨ สร้างตัวอย่าง' : 'ยังไม่มีตัวอย่าง'}
              </p>
            ) : (() => {
              // จัดกลุ่มตาม meaning_line
              const meaningLines = word.thai_meaning.split('\n').filter((l) => l.trim())
              const byLine = {}
              for (const ex of word.examples) {
                const line = Math.min(ex.meaning_line ?? 0, meaningLines.length - 1)
                if (!byLine[line]) byLine[line] = []
                byLine[line].push(ex)
              }
              return (
                <div className="space-y-5">
                  {meaningLines.map((meaning, lineIdx) => {
                    const exs = (byLine[lineIdx] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                    if (!exs.length) return null
                    return (
                      <div key={lineIdx}>
                        {meaningLines.length > 1 && (
                          <div className="text-xs font-medium text-chinese-red mb-2">
                            ความหมาย: {meaning}
                          </div>
                        )}
                        <div className="space-y-3">
                          {exs.map((ex) => (
                            <div key={ex.id} className="border-l-2 border-chinese-gold pl-3">
                              <div className="flex items-center gap-2 mb-1">
                                {user?.is_admin && (
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                                    {getExampleLabel(ex.type)}
                                  </span>
                                )}
                                <button onClick={() => speak(ex.chinese)} className="text-gray-400 text-sm">
                                  🔊
                                </button>
                                <button
                                  onClick={() => navigate('/speaking/practice', {
                                    state: {
                                      wordId: word.id,
                                      wordChinese: word.chinese,
                                      wordPinyin: word.pinyin,
                                      wordThai: word.thai_meaning,
                                      exampleId: ex.id,
                                      chinese: ex.chinese,
                                      pinyin: ex.pinyin,
                                      thai: ex.thai,
                                    }
                                  })}
                                  className="text-[10px] text-purple-500 border border-purple-200 rounded px-1.5 py-0.5 leading-none"
                                >
                                  Speak Training
                                </button>
                              </div>
                              <div className="font-chinese text-lg text-gray-800">
                                {highlightInText(ex.chinese, word.chinese)}
                              </div>
                              {ex.pinyin && <div className="text-sm text-gray-500">{ex.pinyin}</div>}
                              {ex.thai && (
                                <div className="text-sm text-gray-700">
                                  {highlightInText(ex.thai, [meaning, ...meaningLines.filter((_, i) => i !== lineIdx)].join('\n'))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )})()}

        {/* Admin Edit */}
        {user?.is_admin && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-orange-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-orange-600">แก้ไข (Admin)</h3>
              {!editData && (
                <button onClick={startEdit} className="text-xs text-chinese-red">
                  แก้ไข
                </button>
              )}
            </div>
            {editData ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">พินอิน</div>
                  <input
                    value={editData.pinyin}
                    onChange={(e) => setEditData({ ...editData, pinyin: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">ความหมายไทย</div>
                  <textarea
                    value={editData.thai_meaning}
                    onChange={(e) => setEditData({ ...editData, thai_meaning: e.target.value })}
                    rows={4}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red resize-none"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">English</div>
                  <input
                    value={editData.english_meaning}
                    onChange={(e) => setEditData({ ...editData, english_meaning: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">หมวดหมู่</div>
                  <input
                    value={editData.category}
                    onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60"
                  >
                    {editSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                  <button
                    onClick={() => setEditData(null)}
                    className="px-4 border border-gray-200 rounded-lg text-sm"
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">กดแก้ไขเพื่อแก้ไขคำศัพท์นี้</p>
            )}
          </div>
        )}

        {/* Report context — admin เข้ามาจากหน้า "เช็ค" รายงาน */}
        {reportContext && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-yellow-700 mb-1">
              รายงานจาก {reportContext.reportUserName}
            </div>
            <p className="text-sm text-gray-700">{reportContext.reportMsg}</p>
            <p className="text-xs text-gray-400 mt-2">แก้ไขแล้วกด "บันทึก" ด้านบน — รายการนี้จะถูกลบออกอัตโนมัติ</p>
          </div>
        )}

        {/* Notes */}
        {user && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-500">โน้ตส่วนตัว</h3>
              {note && !editingNote && (
                <button
                  onClick={() => setEditingNote(true)}
                  className="text-xs text-chinese-red"
                >
                  แก้ไข
                </button>
              )}
            </div>
            {editingNote || !note ? (
              <div>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="เขียนโน้ตของคุณที่นี่..."
                  className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-chinese-red"
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveNote}
                    className="flex-1 bg-chinese-red text-white rounded-lg py-2 text-sm font-medium"
                  >
                    บันทึก
                  </button>
                  {editingNote && (
                    <button
                      onClick={() => { setNoteText(note?.note_text || ''); setEditingNote(false) }}
                      className="px-4 border border-gray-200 rounded-lg text-sm"
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-700 text-sm whitespace-pre-wrap">{note.note_text}</p>
            )}
          </div>
        )}
      </div>

      {/* Image Popup */}
      {imagePopupOpen && wordImageUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setImagePopupOpen(false)}
        >
          {/* ขนาด 80% ของด้านที่สั้นกว่า (portrait → 80vw, landscape → 80vh) */}
          <div
            className="relative w-[80vw] h-[80vw] max-w-[80vh] max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={wordImageUrl}
              alt={word.chinese}
              className="w-full h-full rounded-xl object-contain"
            />
            {user?.is_admin && (
              <label className="absolute top-2 right-2 bg-black/60 text-white text-sm px-2 py-1 rounded-lg cursor-pointer">
                📷 เปลี่ยนรูป
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { setImagePopupOpen(false); handleUploadImage(e) }} />
              </label>
            )}
            <button
              onClick={() => setImagePopupOpen(false)}
              className="absolute top-2 left-2 bg-black/60 text-white text-sm px-2 py-1 rounded-lg"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h3 className="font-bold text-gray-800">รายงานปัญหาคำศัพท์</h3>
            </div>
            <p className="text-xs text-gray-400">{word.chinese} — {word.pinyin}</p>
            <input
              type="text"
              maxLength={100}
              value={reportMsg}
              onChange={(e) => setReportMsg(e.target.value)}
              placeholder="ระบุปัญหา เช่น พินอินผิด, แปลไม่ถูก..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              autoFocus
            />
            <div className="text-right text-xs text-gray-400">{reportMsg.length}/100</div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowReportModal(false); setReportMsg('') }}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                onClick={sendReport}
                disabled={reportMsg.trim().length < 3 || reportSending}
                className="flex-1 bg-yellow-400 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
              >
                {reportSending ? 'กำลังส่ง...' : 'ส่งรายงาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
