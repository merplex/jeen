import { useNavigate } from 'react-router-dom'

export default function WordCard({ word }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(`/word/${word.id}`)}
      className="w-full text-left bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:border-chinese-red hover:shadow-md transition-all active:scale-95"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-chinese text-2xl text-chinese-red">{word.chinese}</span>
        {word.category && (
          <span className="text-xs bg-chinese-gold/20 text-chinese-gold px-2 py-0.5 rounded-full whitespace-nowrap">
            {word.category}
          </span>
        )}
      </div>
      <div className="text-sm text-gray-500 mt-0.5">{word.pinyin}</div>
      <div className="text-gray-800 mt-1 line-clamp-2">{word.thai_meaning}</div>
      {word.english_meaning && (
        <div className="text-xs text-gray-400 mt-0.5">{word.english_meaning}</div>
      )}
    </button>
  )
}
