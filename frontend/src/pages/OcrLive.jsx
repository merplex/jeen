import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { scanOcrStructured } from '../services/api'
import useAuthStore from '../stores/authStore'

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
  const [scanning, setScanning] = useState(false)
  const [lines, setLines] = useState([])
  const [words, setWords] = useState([])
  const [selectedWord, setSelectedWord] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(null)

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
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75))
  }

  const doScan = useCallback(async () => {
    if (scanningRef.current || !isOnline) return
    const blob = await captureFrame()
    if (!blob) return
    scanningRef.current = true
    setScanning(true)
    try {
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const b64 = btoa(binary)
      const r = await scanOcrStructured({ image_base64: b64, mime_type: 'image/jpeg' })
      setLines(r.data.lines || [])
      setWords(r.data.words || [])
      setSelectedWord((prev) => {
        if (!prev) return null
        const still = r.data.words?.find((w) => w.id === prev.id)
        return still ? prev : null
      })
    } catch {}
    scanningRef.current = false
    setScanning(false)
  }, [isOnline])

  // keep ref updated so interval always calls latest
  useEffect(() => { doScanRef.current = doScan }, [doScan])

  useEffect(() => {
    if (!cameraReady) return
    // initial scan after short delay
    const t = setTimeout(() => doScanRef.current?.(), 800)
    scanTimerRef.current = setInterval(() => doScanRef.current?.(), 4500)
    return () => { clearTimeout(t); clearInterval(scanTimerRef.current) }
  }, [cameraReady])

  const speak = (text) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black overflow-hidden">
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
          <button
            onClick={() => doScanRef.current?.()}
            disabled={scanning || !cameraReady || !isOnline}
            className="text-xs text-white border border-white/40 rounded-lg px-2.5 py-1 disabled:opacity-40"
          >
            สแกน
          </button>
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
      </div>

      {/* ===== Results ===== */}
      <div className="flex-1 overflow-y-auto bg-chinese-cream">

        {/* Offline notice */}
        {!isOnline && (
          <div className="px-4 pt-3">
            <div className="bg-gray-100 rounded-xl px-3 py-2.5 text-center">
              <p className="text-sm text-gray-500">ไม่มีอินเทอร์เน็ต — ไม่สามารถสแกนอัตโนมัติได้</p>
            </div>
          </div>
        )}

        {/* AI Translation lines — online only */}
        {isOnline && lines.length > 0 && (
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs text-gray-400 mb-2 font-medium">คำแปล AI</p>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="bg-white rounded-xl px-3 py-2.5 shadow-sm">
                  <p className="font-chinese text-base text-gray-800 leading-snug">{line.text}</p>
                  {line.translation && (
                    <p className="text-sm text-gray-600 mt-1 leading-snug">{line.translation}</p>
                  )}
                </div>
              ))}
            </div>
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
                {isOnline ? 'จะสแกนอัตโนมัติทุก 4.5 วินาที' : 'ต้องการอินเทอร์เน็ตในการสแกน'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
