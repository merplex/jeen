import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWordImage } from '../services/api'
import MarqueeText from './MarqueeText'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export default function WordImageGridCard({ word }) {
  const navigate = useNavigate()
  const [imgUrl, setImgUrl] = useState(null)   // null = loading, '' = no image
  const [imgError, setImgError] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    setImgUrl(null)
    setImgError(false)

    getWordImage(word.id)
      .then(r => {
        if (!mountedRef.current) return
        const url = r.data?.url
        if (!url) { setImgUrl(''); return }
        // relative path → absolute
        setImgUrl(url.startsWith('/') ? `${BASE_URL}${url}` : url)
      })
      .catch(() => { if (mountedRef.current) setImgUrl('') })

    return () => { mountedRef.current = false }
  }, [word.id])

  const thai = word.thai_meaning?.split('\n')[0] ?? ''

  return (
    <button
      onClick={() => navigate(`/word/${word.id}`)}
      className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-95 transition-transform text-left"
    >
      {/* Image area */}
      <div className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        {imgUrl === null ? (
          /* loading */
          <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        ) : imgUrl && !imgError ? (
          <img
            src={imgUrl}
            alt={word.chinese}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          /* no image — food icon placeholder */
          <svg viewBox="0 0 64 64" className="w-12 h-12 text-gray-200" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* bowl */}
            <path d="M12 28 C12 44 52 44 52 28" />
            <line x1="8" y1="28" x2="56" y2="28" />
            <line x1="32" y1="44" x2="32" y2="50" />
            <line x1="24" y1="50" x2="40" y2="50" />
            {/* steam */}
            <path d="M22 22 C22 18 26 18 26 14" />
            <path d="M32 22 C32 18 36 18 36 14" />
            <path d="M42 22 C42 18 46 18 46 14" />
          </svg>
        )}
      </div>

      {/* Text */}
      <div className="px-2 pt-1.5 pb-2">
        <MarqueeText
          text={word.chinese}
          className="font-chinese text-lg font-medium text-gray-800"
        />
        <MarqueeText
          text={thai}
          className="text-xs text-gray-500 mt-0.5"
        />
      </div>
    </button>
  )
}
