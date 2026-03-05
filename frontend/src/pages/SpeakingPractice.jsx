import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { assessSpeaking, getSpeakingDailyStatus } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function SpeakingPractice() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  // ข้อมูลจาก navigate state
  const { wordId, exampleId, chinese, pinyin, thai } = location.state || {}

  const [status, setStatus] = useState('idle') // 'idle' | 'recording' | 'processing' | 'result' | 'error'
  const [result, setResult] = useState(null)
  const [dailyStatus, setDailyStatus] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  useEffect(() => {
    if (!user) return
    getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})
  }, [user])

  const speak = () => {
    const u = new SpeechSynthesisUtterance(chinese)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  const startRecording = async () => {
    if (!dailyStatus?.can_practice) {
      setErrorMsg('ใช้ครบโควต้าวันนี้แล้ว')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = handleRecordingStop
      mediaRecorderRef.current = mr
      mr.start()
      setStatus('recording')
    } catch {
      setErrorMsg('ไม่สามารถเข้าถึงไมโครโฟนได้')
      setStatus('error')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop())
    setStatus('processing')
  }

  const handleRecordingStop = async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const arrayBuffer = await blob.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)
      const binary = uint8.reduce((acc, b) => acc + String.fromCharCode(b), '')
      const audioBase64 = btoa(binary)

      const r = await assessSpeaking({
        word_id: wordId,
        example_id: exampleId,
        example_chinese: chinese,
        audio_base64: audioBase64,
      })
      setResult(r.data)
      setStatus('result')
      // อัปเดต daily status
      getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})
    } catch (e) {
      setErrorMsg(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
      setStatus('error')
    }
  }

  if (!wordId || !exampleId) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <div className="text-center text-gray-400">
        <p>ไม่มีข้อมูลสำหรับฝึกพูด</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-chinese-red">← กลับ</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate(-1)} className="text-white text-2xl">←</button>
          <h1 className="text-white text-lg font-bold">ฝึกพูด</h1>
        </div>
        {/* Example sentence */}
        <div className="bg-white/15 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-chinese text-2xl text-white">{chinese}</span>
            <button onClick={speak} className="text-white/70 text-lg">🔊</button>
          </div>
          {pinyin && <div className="text-chinese-gold text-sm">{pinyin}</div>}
          {thai && <div className="text-white/80 text-sm mt-1">{thai}</div>}
        </div>
      </div>

      <div className="px-4 py-8 flex flex-col items-center gap-6">
        {/* Daily limit banner */}
        {dailyStatus && !dailyStatus.is_premium && (
          <div className="w-full max-w-sm bg-orange-50 border border-orange-100 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm">⏱</span>
            <span className="text-xs text-orange-700">
              {dailyStatus.can_practice
                ? `เหลือ ${dailyStatus.daily_limit - dailyStatus.today_count} ครั้งวันนี้ (ฟรี ${dailyStatus.daily_limit} ครั้ง/วัน)`
                : 'ใช้ครบโควต้าวันนี้แล้ว'}
            </span>
          </div>
        )}

        {/* Record button */}
        {(status === 'idle' || status === 'recording') && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-500 text-sm">
              {status === 'idle' ? 'กดค้างเพื่ออัดเสียง' : 'กำลังอัดเสียง... ปล่อยเพื่อหยุด'}
            </p>
            <button
              onPointerDown={status === 'idle' ? startRecording : undefined}
              onPointerUp={status === 'recording' ? stopRecording : undefined}
              disabled={!dailyStatus?.can_practice}
              className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-lg transition-all active:scale-95 disabled:opacity-40 ${
                status === 'recording'
                  ? 'bg-red-500 animate-pulse'
                  : 'bg-chinese-red'
              }`}
            >
              🎙
            </button>
            {status === 'recording' && (
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-chinese-red rounded-full animate-bounce"
                    style={{ height: `${Math.random() * 16 + 8}px`, animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <span className="text-2xl animate-spin">⏳</span>
            </div>
            <p className="text-gray-500 text-sm">กำลังประเมิน...</p>
          </div>
        )}

        {/* Result */}
        {status === 'result' && result && (
          <div className="w-full max-w-sm space-y-4">
            {result.is_improved && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-center">
                <span className="text-green-600 text-sm font-medium">ดีขึ้น!</span>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
              {[
                { label: 'ออกเสียง', value: result.pronunciation_score, color: 'bg-blue-400' },
                { label: 'โทนเสียง', value: result.tone_score, color: 'bg-purple-400' },
                { label: 'ความคล่อง', value: result.fluency_score, color: 'bg-green-400' },
              ].map(({ label, value, color }) => {
                const pct = Math.round(value)
                const textColor = pct >= 70 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'
                return (
                  <div key={label}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-sm text-gray-600">{label}</span>
                      <span className={`text-lg font-bold ${textColor}`}>{pct}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setStatus('idle'); setResult(null) }}
                disabled={!dailyStatus?.can_practice}
                className="flex-1 bg-white border border-gray-200 text-gray-600 rounded-xl py-3 text-sm disabled:opacity-40"
              >
                ฝึกอีกรอบ
              </button>
              <button
                onClick={() => navigate(-1)}
                className="flex-1 bg-chinese-red text-white rounded-xl py-3 text-sm"
              >
                กลับ
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="w-full max-w-sm space-y-3">
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
              <p className="text-red-600 text-sm">{errorMsg}</p>
            </div>
            <button
              onClick={() => { setStatus('idle'); setErrorMsg('') }}
              className="w-full bg-white border border-gray-200 rounded-xl py-3 text-sm text-gray-600"
            >
              ลองใหม่
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
