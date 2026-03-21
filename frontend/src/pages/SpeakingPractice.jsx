import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { assessSpeaking, getSpeakingDailyStatus, generateSpeakingSentences } from '../services/api'
import useAuthStore from '../stores/authStore'
import TonedChinese from '../components/TonedChinese'
import OfflineAlert from '../components/OfflineAlert'
import QuotaLimitModal from '../components/QuotaLimitModal'
import TtsSettingsAlert from '../components/TtsSettingsAlert'
import { speakChinese } from '../utils/tts'

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function pcmToWav(pcm, sampleRate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  writeString(v, 0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  writeString(v, 8, 'WAVE')
  writeString(v, 12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)        // PCM
  v.setUint16(22, 1, true)        // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeString(v, 36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true)
  return buf
}

async function blobToWavBase64(blob) {
  const TARGET_RATE = 16000
  const arrayBuffer = await blob.arrayBuffer()
  const decoded = await new AudioContext().decodeAudioData(arrayBuffer)
  // Resample to 16kHz mono via OfflineAudioContext
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_RATE), TARGET_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const samples = rendered.getChannelData(0)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  }
  const wav = pcmToWav(pcm, TARGET_RATE)
  const bytes = new Uint8Array(wav)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export default function SpeakingPractice() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)

  const { wordId, wordChinese, wordPinyin, wordThai, exampleId, chinese, pinyin, thai, isGenerated } = location.state || {}

  // รายการประโยคทั้งหมด: ประโยคแรก = ต้นฉบับจาก DB, ที่เหลือ = generated
  const [sentences, setSentences] = useState(() =>
    chinese ? [{ chinese, pinyin, thai, exampleId, isOriginal: !isGenerated }] : []
  )
  const [sentenceIdx, setSentenceIdx] = useState(0)

  const [status, setStatus] = useState('idle') // idle | recording | processing | result | error
  const [result, setResult] = useState(null)
  const [dailyStatus, setDailyStatus] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [quotaMsg, setQuotaMsg] = useState('')
  const [showOfflineAlert, setShowOfflineAlert] = useState(false)
  const [showTtsAlert, setShowTtsAlert] = useState(false)
  const [quotaModal, setQuotaModal] = useState(null) // null | { quotaType, userTier }

  const showQuotaMsg = (msg) => {
    setQuotaMsg(msg)
    setTimeout(() => setQuotaMsg(''), 3000)
  }

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const mimeTypeRef = useRef('')

  const current = sentences[sentenceIdx] || {}

  useEffect(() => {
    if (!user) return
    getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})
  }, [user])

  const refreshDailyStatus = () =>
    getSpeakingDailyStatus().then((r) => setDailyStatus(r.data)).catch(() => {})

  const speak = (text) => speakChinese(text || current.chinese, { onNoVoice: () => setShowTtsAlert(true) })

  const startRecording = async () => {
    if (!navigator.onLine) { setShowOfflineAlert(true); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      // iOS Safari supports audio/mp4, not audio/webm
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
        : ''
      mimeTypeRef.current = mimeType
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
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
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
      const audioBase64 = await blobToWavBase64(blob)

      const r = await assessSpeaking({
        word_id: wordId,
        example_id: current.exampleId || 0,
        example_chinese: current.chinese,
        example_pinyin: current.pinyin || '',
        is_generated: !current.isOriginal,
        audio_base64: audioBase64,
      })
      setResult(r.data)
      setStatus('result')
      refreshDailyStatus()
    } catch (e) {
      if (e.response?.status === 429) {
        const detail = e.response.data?.detail
        setQuotaModal({ quotaType: detail?.quota_type, userTier: detail?.user_tier })
        setStatus('idle')
      } else {
        setErrorMsg(e.response?.data?.detail || 'เกิดข้อผิดพลาด')
        setStatus('error')
      }
    }
  }

  const handleGenSentences = async () => {
    if (genLoading) return
    if (!navigator.onLine) { setShowOfflineAlert(true); return }
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
  const isFreeTier = dailyStatus?.user_tier === 'free'
  const canGen = !isFreeTier && dailyStatus?.can_gen !== false
  const assessLeft = dailyStatus?.assess_limit != null
    ? dailyStatus.assess_limit - (dailyStatus.today_assess || 0)
    : null

  return (
    <div className="min-h-screen bg-chinese-cream pb-24">
      {quotaModal && (
        <QuotaLimitModal
          quotaType={quotaModal.quotaType}
          userTier={quotaModal.userTier}
          onClose={() => setQuotaModal(null)}
        />
      )}
      {showOfflineAlert && <OfflineAlert onClose={() => setShowOfflineAlert(false)} />}
      {showTtsAlert && <TtsSettingsAlert onClose={() => setShowTtsAlert(false)} />}
      {/* Header */}
      <div className="bg-chinese-red px-4 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(-1)} className="text-white text-2xl">←</button>
          <h1 className="text-white text-lg font-bold">ฝึกพูด</h1>
        </div>

        {/* ประโยคที่กำลังฝึก */}
        <div className="bg-white rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <TonedChinese chinese={current.chinese} pinyin={current.pinyin} className="font-chinese text-2xl leading-tight" />
            <button onClick={() => speak()} className="text-gray-400 text-xl shrink-0">🔊</button>
            {!current.isOriginal && (
              <span className="ml-auto text-[10px] bg-purple-100 text-purple-500 px-1.5 py-0.5 rounded">gen</span>
            )}
          </div>
          {current.pinyin && <div className="text-chinese-gold text-sm">{current.pinyin}</div>}
          {current.thai && <div className="text-gray-500 text-xs mt-0.5">{current.thai}</div>}
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
        <div className="w-full max-w-sm space-y-1.5">
          <button
            onClick={canGen && !genLoading ? handleGenSentences : () => isFreeTier ? setQuotaModal({ quotaType: 'speaking_monthly', userTier: 'free' }) : showQuotaMsg('สร้างประโยคใหม่ได้ 1 ครั้ง/วัน — มาใหม่พรุ่งนี้ หรืออัปเกรด')}
            className={`w-full border rounded-xl py-2.5 text-sm flex items-center justify-center gap-2 transition-opacity ${
              canGen && !genLoading ? 'border-gray-300 bg-white text-gray-600' : 'border-gray-200 bg-gray-50 text-gray-400'
            }`}
          >
            {genLoading ? '⏳ กำลัง gen...' : '✨ สร้างประโยคใหม่'}
          </button>
          {quotaMsg && quotaMsg.includes('สร้าง') && (
            <p className="text-center text-xs text-orange-500">{quotaMsg}</p>
          )}
        </div>

        {/* Record button */}
        {(status === 'idle' || status === 'recording') && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-500 text-sm text-center">
              {status === 'idle'
                ? canPractice ? 'กดค้างเพื่ออัดเสียง' : 'ใช้ครบโควต้าเดือนนี้แล้ว'
                : 'กำลังอัดเสียง... ปล่อยเพื่อหยุด'}
            </p>
            <button
              onPointerDown={status === 'idle' && canPractice ? (navigator.onLine ? startRecording : () => setShowOfflineAlert(true)) : undefined}
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
                <span className="flex items-center gap-1.5">
                  รวม
                  {result.mock && (
                    <span className="bg-orange-100 text-orange-500 px-1.5 py-0.5 rounded text-[10px]">Mock</span>
                  )}
                  {!result.mock && (
                    <span className="bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded text-[10px]">Azure AI</span>
                  )}
                </span>
                <span className="font-medium text-gray-600">
                  {Math.round((result.pronunciation_score + result.tone_score + result.fluency_score) / 3)} / 100
                </span>
              </div>
            </div>

            {/* Word-level breakdown */}
            {result.words?.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-4">
                <p className="text-xs text-gray-400 mb-3 font-medium">ผลรายคำ</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {result.words.map((w, i) => {
                    const score = Math.round(w.accuracy_score)
                    const isMiss = w.error_type === 'Mispronunciation'
                    const isOmit = w.error_type === 'Omission'
                    const cardCls = score >= 80
                      ? 'border-green-400 bg-green-50'
                      : score >= 60
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-red-400 bg-red-50'
                    const numCls = score >= 80 ? 'text-green-600'
                      : score >= 60 ? 'text-yellow-600'
                      : 'text-red-500'
                    return (
                      <div
                        key={i}
                        className={`flex flex-col items-center border-2 rounded-xl px-3 py-2 min-w-[52px] ${cardCls} ${isOmit ? 'opacity-40' : ''}`}
                      >
                        <span className={`font-chinese text-2xl leading-tight ${isOmit ? 'line-through' : ''}`}>
                          {w.word}
                        </span>
                        <span className={`text-xs font-bold mt-0.5 ${numCls}`}>{score}</span>
                        {isMiss && <span className="text-[9px] text-red-400 leading-none mt-0.5">ผิด</span>}
                        {isOmit && <span className="text-[9px] text-gray-400 leading-none mt-0.5">ขาด</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 mt-3">
                  {[
                    { color: 'bg-green-400', label: '≥80 ดี' },
                    { color: 'bg-yellow-400', label: '60–79 พอใช้' },
                    { color: 'bg-red-400', label: '<60 ต้องฝึก' },
                  ].map(({ color, label }) => (
                    <span key={label} className="flex items-center gap-1 text-xs text-gray-400">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {quotaMsg && !quotaMsg.includes('สร้าง') && (
              <p className="text-center text-xs text-orange-500">{quotaMsg}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={canPractice ? retryPractice : () => setQuotaModal({ quotaType: 'speaking_monthly', userTier: dailyStatus?.user_tier || 'free' })}
                className={`flex-1 border rounded-xl py-3 text-sm transition-opacity ${
                  canPractice ? 'bg-white border-gray-200 text-gray-600' : 'bg-gray-50 border-gray-200 text-gray-400'
                }`}
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
