import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { scanOcrStructured } from '../services/api'
import useAuthStore from '../stores/authStore'
import { speakChinese } from '../utils/tts'
import TtsSettingsAlert from '../components/TtsSettingsAlert'
import QuotaLimitModal from '../components/QuotaLimitModal'
import { saveOcrNoteOffline, startOcrNotesSync } from '../services/ocrNotesSyncService'

export default function OcrLive() {
  const navigate = useNavigate()
  const { token } = useAuthStore()

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const scanTimerRef = useRef(null)
  const scanningRef = useRef(false)
  const doScanRef = useRef(null)

  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showTtsAlert, setShowTtsAlert] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [lines, setLines] = useState([])
  const [translation, setTranslation] = useState('')
  const [words, setWords] = useState([])
  const [selectedWord, setSelectedWord] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [scanError, setScanError] = useState(null)
  const [quotaModal, setQuotaModal] = useState(null)
  const [translateMode, setTranslateMode] = useState('general')
  const [translationChat, setTranslationChat] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)

  useEffect(() => {
    if (!token) { navigate('/login', { replace: true }); return }
  }, [token])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const stopCamera = useCallback(() => {
    clearInterval(scanTimerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setCameraReady(true)
        }
      } catch (err) {
        setCameraError('ไม่สามารถเปิดกล้องได้\n' + err.message)
      }
    }
    start()
    return () => stopCamera()
  }, [stopCamera])

  const captureFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null
    // Cap to 1280px max to avoid oversized base64 on high-res iOS cameras
    const MAX_DIM = 1280
    let w = video.videoWidth
    let h = video.videoHeight
    if (w > MAX_DIM || h > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h)
      w = Math.round(w * ratio)
      h = Math.round(h * ratio)
    }
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
  }

  const doScan = useCallback(async () => {
    if (scanningRef.current || !isOnline) return
    const blob = await captureFrame()
    if (!blob) return
    scanningRef.current = true
    setScanning(true)
    setScanError(null)
    try {
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      const r = await scanOcrStructured({ image_base64: b64, mime_type: 'image/jpeg' })
      setLines(r.data.lines || [])
      setTranslation(r.data.translation || '')
      setTranslationChat(r.data.translation_chat || '')
      setWords(r.data.words || [])
      setNoteSaved(false)
      setSelectedWord((prev) => {
        if (!prev) return null
        const still = r.data.words?.find((w) => w.id === prev.id)
        return still ? prev : null
      })
    } catch (err) {
      const detail = err.response?.data?.detail
      if (err.response?.status === 429 && detail?.quota_type) {
        setQuotaModal({ quotaType: detail.quota_type, userTier: detail.user_tier })
      } else {
        setScanError(typeof detail === 'string' ? detail : err.message || 'เกิดข้อผิดพลาด')
      }
    }
    scanningRef.current = false
    setScanning(false)
  }, [isOnline])

  // keep ref updated so interval always calls latest
  useEffect(() => { doScanRef.current = doScan }, [doScan])

  useEffect(() => {
    if (!cameraReady) return
  }, [cameraReady])

  const speak = (text) => speakChinese(text, { onNoVoice: () => setShowTtsAlert(true) })

  const handleSaveNote = async () => {
    const text = translateMode === 'chat' ? translationChat : translation
    if (!text) return
    const wordsJson = words.length > 0
      ? JSON.stringify(words.map(w => ({ id: w.id, chinese: w.chinese, pinyin: w.pinyin, thai_meaning: w.thai_meaning })))
      : null
    await saveOcrNoteOffline({ translationText: text, translationMode: translateMode, wordsJson })
    setNoteSaved(true)
    startOcrNotesSync(token)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black overflow-hidden">
      {showTtsAlert && <TtsSettingsAlert onClose={() => setShowTtsAlert(false)} />}
      {quotaModal && <QuotaLimitModal quotaType={quotaModal.quotaType} userTier={quotaModal.userTier} onClose={() => setQuotaModal(null)} />}
      {/* ===== Camera ===== */}
      <div className="relative flex-none" style={{ height: '42vh' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Header overlay */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-10 pb-3 bg-gradient-to-b from-black/70 to-transparent">
          <button
            onClick={() => { stopCamera(); navigate(-1) }}
            className="text-white text-2xl leading-none px-1"
          >
            ←
          </button>
          <div className="flex items-center gap-2">
            {scanning ? (
              <span className="text-xs text-yellow-300 flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                กำลังสแกน...
              </span>
            ) : (
              <span className="text-xs text-white/70">● Live OCR</span>
            )}
            <div
              className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-400'}`}
              title={isOnline ? 'ออนไลน์' : 'ออฟไลน์'}
            />
          </div>
          <div className="w-16" />
        </div>

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 px-6">
            <p className="text-white text-sm text-center whitespace-pre-line">{cameraError}</p>
          </div>
        )}

        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-white/60 text-sm">กำลังเปิดกล้อง...</p>
          </div>
        )}

        {/* Scan button — bottom center */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            onClick={() => doScanRef.current?.()}
            disabled={scanning || !cameraReady || !isOnline}
            className="w-16 h-16 rounded-full bg-white/90 shadow-lg flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          >
            {scanning ? (
              <svg className="w-6 h-6 animate-spin text-gray-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <div className="w-12 h-12 rounded-full bg-chinese-red/90" />
            )}
          </button>
        </div>
      </div>

      {/* ===== Results ===== */}
      <div className="flex-1 overflow-y-auto bg-chinese-cream">

        {/* Translation mode toggle */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <span className="text-xs text-gray-400">โหมดแปล</span>
          <div className="flex rounded-full border border-gray-200 overflow-hidden text-xs ml-1">
            <button
              onClick={() => setTranslateMode('general')}
              className={`px-3 py-1.5 transition-colors ${translateMode === 'general' ? 'bg-chinese-red text-white' : 'bg-white text-gray-500'}`}
            >ทั่วไป</button>
            <button
              onClick={() => setTranslateMode('chat')}
              className={`px-3 py-1.5 transition-colors ${translateMode === 'chat' ? 'bg-chinese-red text-white' : 'bg-white text-gray-500'}`}
            >สนทนา</button>
          </div>
        </div>

        {/* Scan error */}
        {scanError && (
          <div className="px-4 pt-3">
            <div className="bg-red-50 rounded-xl px-3 py-2.5 text-center">
              <p className="text-sm text-red-500">{scanError}</p>
            </div>
          </div>
        )}

        {/* Offline notice */}
        {!isOnline && (
          <div className="px-4 pt-3">
            <div className="bg-gray-100 rounded-xl px-3 py-2.5 text-center">
              <p className="text-sm text-gray-500">ไม่มีอินเทอร์เน็ต — ไม่สามารถสแกนอัตโนมัติได้</p>
            </div>
          </div>
        )}

        {/* AI Translation — online only */}
        {isOnline && (lines.length > 0 || translation) && (
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs text-gray-400 mb-2 font-medium">คำแปล AI</p>
            <div className="bg-white rounded-xl px-3 py-3 shadow-sm space-y-2">
              {/* แสดงตาม mode ที่เลือก */}
              {(() => {
                const displayed = translateMode === 'chat' ? translationChat : translation
                return displayed ? (
                  <div>
                    {displayed.split('\n').map((t, i) => (
                      t.trim()
                        ? <p key={i} className="text-sm text-gray-700 leading-snug">{t}</p>
                        : <div key={i} className="h-2" />
                    ))}
                  </div>
                ) : null
              })()}
              {/* Chinese reference below */}
              {lines.length > 0 && (
                <div className="border-t border-gray-100 pt-2">
                  {lines.map((line, i) => (
                    <p key={i} className="font-chinese text-sm text-gray-400 leading-snug">
                      {line.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Save to note button */}
        {isOnline && (translation || translationChat) && (
          <div className="px-4 pb-1">
            <button
              onClick={handleSaveNote}
              disabled={noteSaved}
              className={`w-full rounded-xl py-2.5 text-sm font-medium transition-colors ${
                noteSaved
                  ? 'bg-green-100 text-green-600'
                  : 'bg-chinese-red/10 text-chinese-red active:bg-chinese-red/20'
              }`}
            >
              {noteSaved ? 'บันทึกแล้ว' : 'บันทึกไปโน้ต'}
            </button>
          </div>
        )}

        {/* Vocabulary from DB */}
        <div className="px-4 pt-3 pb-8">
          {words.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mb-2 font-medium">
                คำศัพท์ในฐานข้อมูล ({words.length} คำ)
              </p>
              <div className="space-y-1.5">
                {words.map((w) => {
                  const isSelected = selectedWord?.id === w.id
                  return (
                    <div key={w.id}>
                      <button
                        onClick={() => setSelectedWord(isSelected ? null : w)}
                        className={`w-full text-left rounded-xl px-3 py-2.5 flex items-center gap-2 transition-colors shadow-sm ${
                          isSelected
                            ? 'bg-chinese-red/10 border border-chinese-red/30'
                            : 'bg-white'
                        }`}
                      >
                        <span className="font-chinese text-xl text-chinese-red w-10 shrink-0">
                          {w.chinese}
                        </span>
                        <span className="text-xs text-gray-400">{w.pinyin}</span>
                        <span className="text-xs text-gray-700 ml-auto line-clamp-1 text-right max-w-[40%]">
                          {w.thai_meaning?.split('\n')[0]}
                        </span>
                        <span className="text-gray-300 text-xs shrink-0">
                          {isSelected ? '▲' : '▼'}
                        </span>
                      </button>

                      {/* Inline word detail */}
                      {isSelected && (
                        <div className="mt-1 bg-white rounded-xl px-4 py-3 shadow-sm border border-chinese-red/20">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <span className="font-chinese text-4xl text-chinese-red leading-none">
                                {w.chinese}
                              </span>
                              <p className="text-chinese-gold text-sm mt-1">{w.pinyin}</p>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => speak(w.chinese)}
                                className="text-xl"
                                title="ออกเสียง"
                              >
                                🔊
                              </button>
                              <button
                                onClick={() => {
                                  stopCamera()
                                  navigate(`/word/${w.id}`)
                                }}
                                className="text-xs text-chinese-red border border-chinese-red/50 rounded-lg px-2.5 py-1.5 leading-none"
                              >
                                รายละเอียด →
                              </button>
                            </div>
                          </div>
                          <div className="text-gray-700 text-sm space-y-0.5">
                            {w.thai_meaning
                              ?.split('\n')
                              .filter((l) => l.trim())
                              .map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Empty state */}
          {words.length === 0 && lines.length === 0 && cameraReady && !scanning && (
            <div className="text-center py-8 text-gray-400">
              <div className="font-chinese text-5xl text-chinese-red/20 mb-3">字</div>
              <p className="text-sm">ส่องกล้องไปที่ข้อความภาษาจีน</p>
              <p className="text-xs mt-1 text-gray-300">
                {isOnline ? 'กดปุ่มด้านล่างเพื่อสแกน' : 'ต้องการอินเทอร์เน็ตในการสแกน'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
