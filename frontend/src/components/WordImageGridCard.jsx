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
          /* no image — colorful noodle bowl icon */
          <svg viewBox="0 0 64 64" className="w-14 h-14" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* steam */}
            <path d="M22 18 C21 15 23 13 22 10" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <path d="M32 18 C31 15 33 13 32 10" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" fill="none"/>
            <path d="M42 18 C41 15 43 13 42 10" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" fill="none"/>
            {/* bowl body */}
            <path d="M10 28 C10 46 54 46 54 28 Z" fill="#FEF3C7"/>
            <path d="M10 28 C10 46 54 46 54 28" stroke="#F59E0B" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            {/* rim */}
            <rect x="8" y="24" width="48" height="6" rx="3" fill="#F59E0B"/>
            {/* noodles inside */}
            <path d="M18 30 Q22 27 26 30 Q30 33 34 30 Q38 27 42 30" stroke="#EF4444" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <path d="M16 34 Q21 31 25 34 Q29 37 33 34 Q37 31 41 34 Q45 37 46 34" stroke="#F97316" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            {/* base */}
            <rect x="26" y="46" width="12" height="3" rx="1.5" fill="#F59E0B"/>
            <rect x="22" y="49" width="20" height="3" rx="1.5" fill="#F59E0B"/>
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
