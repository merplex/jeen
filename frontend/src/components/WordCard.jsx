import { useNavigate } from 'react-router-dom'
import TonedChinese from './TonedChinese'

export default function WordCard({ word }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/word/${word.id}`)}
      className="w-full text-left bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:border-chinese-red hover:shadow-md transition-all active:scale-95"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <TonedChinese chinese={word.chinese} pinyin={word.pinyin} className="font-chinese text-2xl" />
          {word.has_multiple_readings && (
            <div className="text-[10px] text-gray-400 leading-none -mt-0.5">(1)</div>
          )}
        </div>
        {word.category && (
          <span className="text-xs bg-chinese-gold/20 text-chinese-gold px-2 py-0.5 rounded-full whitespace-nowrap">
            {word.category}
          </span>
        )}
      </div>
      <div className="text-sm text-gray-500 mt-0.5">{word.pinyin}</div>
      <div className="text-gray-800 mt-1">
        {(() => {
          const lines = word.thai_meaning.split('\n').filter((l) => l.trim())
          return (
            <>
              {lines.slice(0, 2).map((line, i) => (
                <div key={i} className="text-sm leading-snug">{line}</div>
              ))}
              {lines.length > 2 && (
                <div className="text-xs text-gray-400">+{lines.length - 2} ความหมาย</div>
              )}
            </>
          )
        })()}
      </div>
      {word.english_meaning && (
        <div className="text-xs text-gray-400 mt-0.5">{word.english_meaning}</div>
      )}
    </button>
  )
}
