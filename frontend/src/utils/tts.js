// speakChinese — ลอง Google TTS ก่อน ถ้า fail ค่อย fallback device TTS
// onNoVoice: callback เมื่อไม่มี Chinese voice ในเครื่อง
export function speakChinese(text, { onNoVoice } = {}) {
  if (!text) return

  // fallback ไปใช้ device speechSynthesis (ป้องกัน call ซ้ำ)
  let fallbackCalled = false
  const fallbackToDevice = () => {
    if (fallbackCalled) return
    fallbackCalled = true
    const voices = speechSynthesis.getVoices()
    const zhVoice = voices.find(v => v.lang.startsWith('zh'))
    if (zhVoice || voices.length === 0) {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      if (zhVoice) u.voice = zhVoice
      speechSynthesis.speak(u)
    } else {
      onNoVoice?.()
    }
  }

  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=zh-CN&client=gtx`
  const audio = new Audio(url)
  // onerror: network fail / CORS / offline → play() ไม่ reject แต่ fire event นี้
  audio.onerror = fallbackToDevice
  // play() reject: autoplay blocked หรือ format ไม่รองรับ
  audio.play().catch(fallbackToDevice)
}
