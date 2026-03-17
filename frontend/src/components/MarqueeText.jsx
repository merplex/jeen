import { useRef, useEffect, useState } from 'react'

/**
 * แสดงข้อความ 1 บรรทัด — ถ้ายาวเกิน container จะหยุด 1 วินาที แล้วเลื่อนไปซ้ายจนสุด
 */
export default function MarqueeText({ text, className = '' }) {
  const containerRef = useRef(null)
  const textRef = useRef(null)
  const [scrollPx, setScrollPx] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    setScrollPx(0)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!containerRef.current || !textRef.current) return
      const overflow = textRef.current.scrollWidth - containerRef.current.clientWidth
      if (overflow > 0) setScrollPx(overflow)
    }, 1000)
    return () => clearTimeout(timerRef.current)
  }, [text])

  // duration proportional to distance: 60px/s baseline
  const duration = scrollPx > 0 ? Math.max(scrollPx / 60, 0.8) : 0

  return (
    <div ref={containerRef} className={`overflow-hidden ${className}`}>
      <span
        ref={textRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          transform: `translateX(-${scrollPx}px)`,
          transition: scrollPx > 0 ? `transform ${duration}s linear` : 'none',
        }}
      >
        {text}
      </span>
    </div>
  )
}
