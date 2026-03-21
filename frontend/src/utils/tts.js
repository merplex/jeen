// speakChinese — ลอง Google TTS ก่อน ถ้า fail ค่อย fallback device TTS
// onNoVoice: callback เมื่อ offline และไม่มี Chinese voice ในเครื่อง
export function speakChinese(text, { onNoVoice } = {}) {
  if (!text) return

  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=zh-CN&client=gtx`
  const audio = new Audio(url)
  audio.play().catch(() => {
    // ออนไลน์ก็ fail หรือ offline → ลอง device TTS
    const voices = speechSynthesis.getVoices()
    const zhVoice = voices.find(v => v.lang.startsWith('zh'))
    if (zhVoice || voices.length === 0) {
      // มี voice หรือยังโหลดไม่เสร็จ → ลอง speak ตามปกติ
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      if (zhVoice) u.voice = zhVoice
      speechSynthesis.speak(u)
    } else {
      // มี voice แต่ไม่มี Chinese → แจ้ง user
      onNoVoice?.()
    }
  })
}
