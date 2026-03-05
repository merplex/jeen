import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { assessSpeaking, getSpeakingDailyStatus, generateSpeakingSentences } from '../services/api'
import useAuthStore from '../stores/authStore'

export default function SpeakingPractice() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  const { wordId, wordChinese, wordPinyin, wordThai, exampleId, chinese, pinyin, thai } = location.state || {}

  // รายการประโยคทั้งหมด: ประโยคแรก = ต้นฉบับจาก DB, ที่เหลือ = generated
  const [sentences, setSentences] = useState(() =>
    chinese ? [{ chinese, pinyin, thai, exampleId, isOriginal: true }] : []
  )
  const [sentenceIdx, setSentenceIdx] = useState(0)

  const [status, setStatus] = useState('idle') // idle | recording | processing | result | error
  const [result, setResult] = useState(null)
  const [dailyStatus, setDailyStatus] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [genLoading, setGenLoading] = useState(false)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  const current = sentences[sentenceIdx] || {}

  useEffect(() => {
    if (!user) return
    getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})
  }, [user])

  const refreshDailyStatus = () =>
    getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})

  const speak = (text) => {
    const u = new SpeechSynthesisUtterance(text || current.chinese)
    u.lang = 'zh-CN'
    speechSynthesis.speak(u)
  }

  const startRecording = async () => {
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
        example_id: current.exampleId || 0,  // 0 = generated
        example_chinese: current.chinese,
        audio_base64: audioBase64,
      })
      setResult(r.data)
      setStatus('result')
      refreshDailyStatus()
    } catch (e) {
      setErrorMsg(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
      setStatus('error')
    }
  }

  const handleGenSentences = async () => {
    if (genLoading) return
    setGenLoading(true)
    try {
      const r = await generateSpeakingSentences({
        word_id: wordId,
        chinese: wordChinese,
        pinyin: wordPinyin,
        thai_meaning: wordThai,
      })
      const generated = r.data.map((s) => ({ ...s, exampleId: 0, isOriginal: false }))
      setSentences((prev) => {
        // ลบ generated เก่าออก เก็บต้นฉบับ + generated ใหม่
        const originals = prev.filter((s) => s.isOriginal)
        return [...originals, ...generated]
      })
      // ชี้ไปที่ generated แรก
      setSentenceIdx(sentences.filter((s) => s.isOriginal).length)
      refreshDailyStatus()
    } catch (e) {
      setErrorMsg(e.response?.data?.detail || 'ไม่สามารถ gen ประโยคได้')
    }
    setGenLoading(false)
  }

  const retryPractice = () => {
    setStatus('idle')
    setResult(null)
    setErrorMsg('')
  }

  if (!wordId) return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center">
      <div className="text-center text-gray-400">
        <p>ไม่มีข้อมูลสำหรับฝึกพูด</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-chinese-red">← กลับ</button>
      </div>
    </div>
  )

  const canPractice = dailyStatus?.can_practice !== false
  const canGen = dailyStatus?.can_gen !== false
  const assessLeft = dailyStatus?.assess_limit != null
    ? dailyStatus.assess_limit - (dailyStatus.today_assess || 0)
    : null

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(-1)} className="text-white text-2xl">←</button>
          <h1 className="text-white text-lg font-bold">ฝึกพูด</h1>
          {assessLeft != null && (
            <span className="ml-auto text-white/70 text-xs">เหลือ {assessLeft} ครั้งวันนี้</span>
          )}
        </div>

        {/* ประโยคที่กำลังฝึก */}
        <div className="bg-white/15 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-chinese text-2xl text-white leading-tight">{current.chinese}</span>
            <button onClick={() => speak()} className="text-white/70 text-xl shrink-0">🔊</button>
            {!current.isOriginal && (
              <span className="ml-auto text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded">gen</span>
            )}
          </div>
          {current.pinyin && <div className="text-chinese-gold text-sm">{current.pinyin}</div>}
          {current.thai && <div className="text-white/80 text-xs mt-0.5">{current.thai}</div>}
        </div>

        {/* Sentence tabs */}
        {sentences.length > 1 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {sentences.map((s, i) => (
              <button
                key={i}
                onClick={() => { setSentenceIdx(i); retryPractice() }}
                className={`text-xs px-2 py-1 rounded-lg transition-all ${
                  i === sentenceIdx
                    ? 'bg-white text-chinese-red font-medium'
                    : 'bg-white/20 text-white'
                }`}
              >
                {s.isOriginal ? 'ต้นฉบับ' : `ประโยค ${i}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-6 flex flex-col items-center gap-5">
        {/* ปุ่ม Gen ประโยคใหม่ */}
        <div className="w-full max-w-sm">
          <button
            onClick={handleGenSentences}
            disabled={genLoading || !canGen}
            className="w-full border border-gray-300 bg-white rounded-xl py-2.5 text-sm text-gray-600 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {genLoading ? '⏳ กำลัง gen...' : '✨ เปลี่ยนประโยค (Gemini)'}
            {!canGen && <span className="text-xs text-orange-500">หมดโควต้าวันนี้</span>}
          </button>
        </div>

        {/* Record button */}
        {(status === 'idle' || status === 'recording') && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-500 text-sm text-center">
              {status === 'idle'
                ? canPractice ? 'กดค้างเพื่ออัดเสียง' : 'ใช้ครบโควต้าวันนี้แล้ว (ฟรี 3 ครั้ง/วัน)'
                : 'กำลังอัดเสียง... ปล่อยเพื่อหยุด'}
            </p>
            <button
              onPointerDown={status === 'idle' && canPractice ? startRecording : undefined}
              onPointerUp={status === 'recording' ? stopRecording : undefined}
              disabled={!canPractice}
              className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-lg transition-all active:scale-95 disabled:opacity-40 select-none ${
                status === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-chinese-red'
              }`}
            >
              🎙
            </button>
            {status === 'recording' && (
              <div className="flex gap-1 items-end h-6">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-chinese-red rounded-full animate-bounce"
                    style={{ height: `${8 + (i % 3) * 6}px`, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center animate-pulse">
              <span className="text-2xl">⏳</span>
            </div>
            <p className="text-gray-500 text-sm">กำลังประเมินเสียง...</p>
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

            <div className="bg-white rounded-2xl shadow-md p-5 space-y-4">
              {[
                { label: 'ออกเสียง', sub: 'Pronunciation', value: result.pronunciation_score, color: 'bg-blue-400' },
                { label: 'โทนเสียง', sub: 'Tone', value: result.tone_score, color: 'bg-purple-400' },
                { label: 'ความคล่อง', sub: 'Fluency', value: result.fluency_score, color: 'bg-green-400' },
              ].map(({ label, sub, value, color }) => {
                const pct = Math.round(value)
                const grade = pct >= 70 ? { text: 'ดี', color: 'text-green-600' }
                  : pct >= 50 ? { text: 'พอใช้', color: 'text-yellow-600' }
                  : pct >= 30 ? { text: 'ฝึกเพิ่ม', color: 'text-orange-500' }
                  : { text: 'ต้องฝึกมาก', color: 'text-red-500' }
                return (
                  <div key={label}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <div>
                        <span className="text-sm text-gray-700 font-medium">{label}</span>
                        <span className="text-xs text-gray-400 ml-1">{sub}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-xs ${grade.color}`}>{grade.text}</span>
                        <span className="text-xl font-bold text-gray-800">{pct}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}

              <div className="pt-1 border-t border-gray-100 flex justify-between text-xs text-gray-400">
                <span>รวม</span>
                <span className="font-medium text-gray-600">
                  {Math.round((result.pronunciation_score + result.tone_score + result.fluency_score) / 3)} / 100
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={retryPractice}
                disabled={!canPractice}
                className="flex-1 bg-white border border-gray-200 text-gray-600 rounded-xl py-3 text-sm disabled:opacity-40"
              >
                ฝึกซ้ำ
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
              onClick={retryPractice}
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
