const CHINESE_RE = /[\u4e00-\u9fff]/

// Scan pinyin string left-to-right for diacritic tone marks in order.
// Works correctly even when multiple syllables are merged without spaces
// (e.g. "húdié" for 蝴蝶, "piàoliang" for 漂亮, "xǐhuān" for 喜欢).
const TONE1_SET = new Set([...'āēīōūǖ'])
const TONE2_SET = new Set([...'áéíóúǘ'])
const TONE3_SET = new Set([...'ǎěǐǒǔǚ'])
const TONE4_SET = new Set([...'àèìòùǜ'])

function extractTones(pinyin) {
  if (!pinyin) return []
  const tones = []
  for (const ch of pinyin) {
    if (TONE1_SET.has(ch)) tones.push(1)
    else if (TONE2_SET.has(ch)) tones.push(2)
    else if (TONE3_SET.has(ch)) tones.push(3)
    else if (TONE4_SET.has(ch)) tones.push(4)
    // numeric pinyin fallback (e.g. "hao3")
    else if (ch >= '1' && ch <= '4') tones.push(Number(ch))
  }
  return tones
}

const TONE_CLASS = {
  1: 'text-chinese-red',
  2: 'text-yellow-500',
  3: 'text-green-500',
  4: 'text-blue-500',
}

export default function TonedChinese({ chinese, pinyin, className = '' }) {
  if (!chinese) return null
  const chars = Array.from(chinese)
  const tones = extractTones(pinyin)
  let ti = 0
  return (
    <span className={className}>
      {chars.map((ch, i) => {
        if (CHINESE_RE.test(ch)) {
          const tone = tones[ti++] ?? 0
          return <span key={i} className={TONE_CLASS[tone] || ''}>{ch}</span>
        }
        return <span key={i}>{ch}</span>
      })}
    </span>
  )
}
