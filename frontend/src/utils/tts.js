import { TextToSpeech } from '@capacitor-community/text-to-speech'

// speakChinese — ลอง Google TTS ก่อน ถ้า fail ค่อย fallback Capacitor TTS plugin
// onNoVoice: callback เมื่อไม่มี Chinese voice ในเครื่อง
export function speakChinese(text, { onNoVoice } = {}) {
  if (!text) return

  const fallbackToDevice = async () => {
    try {
      await TextToSpeech.speak({
        text,
        lang: 'zh-CN',
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient',
      })
    } catch (e) {
      onNoVoice?.()
    }
  }

  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=zh-CN&client=gtx`
  const audio = new Audio(url)
  audio.onerror = fallbackToDevice
  audio.play().catch(fallbackToDevice)
}
