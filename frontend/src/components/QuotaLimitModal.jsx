import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const DEVELOPER_EMAIL = 'merplex@gmail.com'

export default function QuotaLimitModal({ quotaType, userTier, onClose }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  const isDaily = quotaType === 'word_detail_daily'
  const title = isDaily ? 'Day Limit Reached' : 'Monthly Limit Reached'
  const waitMsg = isDaily
    ? 'กรุณารอใช้งานวันพรุ้งนี้'
    : 'กรุณารอใช้งานในเดือนถัดไป'

  const showLearnerBtn = userTier === 'free'
  const showSuperuserBtn = userTier === 'free' || userTier === 'learner'
  const showDeveloperBtn = userTier === 'superuser'

  const handleUpgrade = () => {
    onClose()
    navigate('/profile')
  }

  const handleDeveloper = () => {
    navigator.clipboard?.writeText(DEVELOPER_EMAIL).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
      <div className="bg-white rounded-t-2xl p-6 w-full max-w-sm shadow-xl pb-10">
        <h2 className="text-lg font-bold text-gray-800 mb-1">{title}</h2>
        <p className="text-sm text-gray-500 mb-5">
          {waitMsg}
          {!showDeveloperBtn && (
            <> หรือ Upgrade to</>
          )}
          {showDeveloperBtn && (
            <> หรือ ติดต่อ</>
          )}
        </p>

        <div className="flex flex-col gap-2">
          {showLearnerBtn && (
            <button
              onClick={handleUpgrade}
              className="w-full py-3 rounded-xl bg-blue-500 text-white font-semibold text-sm"
            >
              Learner
            </button>
          )}
          {showSuperuserBtn && (
            <button
              onClick={handleUpgrade}
              className="w-full py-3 rounded-xl bg-yellow-500 text-white font-semibold text-sm"
            >
              Superuser
            </button>
          )}
          {showDeveloperBtn && (
            <button
              onClick={handleDeveloper}
              className="w-full py-3 rounded-xl bg-gray-700 text-white font-semibold text-sm"
            >
              {copied ? `Copied: ${DEVELOPER_EMAIL}` : 'Developer'}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-sm"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
