const CHINESE_RE = /[\u4e00-\u9fff]/

function getTone(syllable) {
  if (!syllable) return 0
  const m = syllable.match(/[1-5]/)
  if (m) return parseInt(m[0])
  if (/[āēīōūǖ]/.test(syllable)) return 1
  if (/[áéíóúǘ]/.test(syllable)) return 2
  if (/[ǎěǐǒǔǚ]/.test(syllable)) return 3
  if (/[àèìòùǜ]/.test(syllable)) return 4
  return 0
}

const TONE_CLASS = {
  1: 'text-chinese-red',
  2: 'text-yellow-500',
  3: 'text-green-500',
  4: 'text-blue-500',
}

// Renders Chinese text with each character colored by its tone.
// Non-Chinese characters are rendered as-is, inheriting parent color.
export default function TonedChinese({ chinese, pinyin, className = '' }) {
  if (!chinese) return null
  const chars = Array.from(chinese)
  const syllables = pinyin ? pinyin.trim().split(/\s+/) : []
  let si = 0
  return (
    <span className={className}>
      {chars.map((ch, i) => {
        if (CHINESE_RE.test(ch)) {
          const tone = getTone(syllables[si++])
          return <span key={i} className={TONE_CLASS[tone] || ''}>{ch}</span>
        }
        return <span key={i}>{ch}</span>
      })}
    </span>
  )
}
