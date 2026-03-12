import { useState } from 'react'
import axios from 'axios'
import { requestEmailOtp, verifyEmailOtp } from '../services/api'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const STEPS = { EMAIL: 'email', OTP: 'otp', CONFIRM: 'confirm', DONE: 'done' }

export default function DeleteAccount() {
  const [step, setStep] = useState(STEPS.EMAIL)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRequestOtp = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await requestEmailOtp(email.trim())
      setStep(STEPS.OTP)
    } catch (e) {
      setError(e.response?.data?.detail || 'ส่ง OTP ไม่สำเร็จ')
    }
    setLoading(false)
  }

  const handleVerifyOtp = async () => {
    if (!otp.trim()) return
    setLoading(true)
    setError('')
    try {
      const r = await verifyEmailOtp(email.trim(), otp.trim())
      setToken(r.data.verify_token)
      setStep(STEPS.CONFIRM)
    } catch (e) {
      setError(e.response?.data?.detail || 'OTP ไม่ถูกต้อง')
    }
    setLoading(false)
  }

  const handleDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await axios.post(`${BASE_URL}/auth/account/delete-by-email`, { email: email.trim(), verify_token: token })
      setStep(STEPS.DONE)
    } catch (e) {
      setError(e.response?.data?.detail || 'ลบบัญชีไม่สำเร็จ')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-chinese-cream flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-sm space-y-4">
        <div className="text-center">
          <div className="text-4xl mb-2">🗑️</div>
          <h1 className="text-lg font-bold text-gray-800">ลบบัญชี C-T Scan</h1>
          <p className="text-xs text-gray-400 mt-1">ข้อมูลทั้งหมดจะถูกลบถาวร</p>
        </div>

        {step === STEPS.EMAIL && (
          <>
            <div>
              <div className="text-sm text-gray-500 mb-1">อีเมลที่ใช้สมัคร</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-chinese-red"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleRequestOtp}
              disabled={loading || !email.trim()}
              className="w-full bg-chinese-red text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'กำลังส่ง...' : 'ส่ง OTP ยืนยัน'}
            </button>
          </>
        )}

        {step === STEPS.OTP && (
          <>
            <p className="text-sm text-gray-500">กรอก OTP ที่ส่งไปที่ <span className="font-medium text-gray-700">{email}</span></p>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="รหัส OTP"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-chinese-red"
              maxLength={6}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleVerifyOtp}
              disabled={loading || !otp.trim()}
              className="w-full bg-chinese-red text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'กำลังตรวจสอบ...' : 'ยืนยัน OTP'}
            </button>
          </>
        )}

        {step === STEPS.CONFIRM && (
          <>
            <div className="bg-red-50 rounded-xl p-3 space-y-1">
              <p className="text-sm font-medium text-red-700">ข้อมูลที่จะถูกลบถาวร:</p>
              <ul className="text-xs text-red-600 space-y-0.5 list-disc list-inside">
                <li>ข้อมูลบัญชีและโปรไฟล์</li>
                <li>ประวัติการค้นหา</li>
                <li>Flashcard และ deck ทั้งหมด</li>
                <li>โน้ตส่วนตัว</li>
                <li>คำโปรด</li>
              </ul>
            </div>
            <p className="text-xs text-gray-400 text-center">การดำเนินการนี้ไม่สามารถยกเลิกได้</p>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleDelete}
              disabled={loading}
              className="w-full bg-red-600 text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'กำลังลบ...' : 'ยืนยันลบบัญชีถาวร'}
            </button>
            <button
              onClick={() => setStep(STEPS.EMAIL)}
              className="w-full text-gray-400 text-sm py-1"
            >
              ยกเลิก
            </button>
          </>
        )}

        {step === STEPS.DONE && (
          <div className="text-center space-y-2 py-4">
            <div className="text-4xl">✅</div>
            <p className="text-gray-700 font-medium">ลบบัญชีเรียบร้อยแล้ว</p>
            <p className="text-xs text-gray-400">ข้อมูลทั้งหมดของคุณถูกลบออกจากระบบแล้ว</p>
          </div>
        )}
      </div>
    </div>
  )
}
