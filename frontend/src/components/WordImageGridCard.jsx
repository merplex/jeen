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
          /* no image */
          <span className="text-3xl text-gray-300">📷</span>
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
