import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifier) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier })
      })
      if (res.ok) setSent(true)
    } catch {}
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
        <div className="w-full max-w-md card p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
          <p className="text-[var(--text-muted)]">We've sent a verification code to your email</p>
          <Link to="/auth/reset-password" className="btn-primary mt-6 block">Continue</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-bold text-center mb-2">Reset Password</h1>
        <p className="text-center text-[var(--text-muted)] mb-6">Enter your email or phone</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input-field" placeholder="Email or phone" />
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Sending...' : 'Continue'}
          </button>
        </form>
        <p className="text-center text-sm mt-4">
          Remember password? <Link to="/auth/login" className="text-[var(--primary)]">Login</Link>
        </p>
      </div>
    </div>
  )
}

export default function ResetPassword() {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, newPassword: password })
      })
      window.location.href = '/auth/login'
    } catch {}
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-bold text-center mb-6">New Password</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input-field" placeholder="Verification code" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" placeholder="New password" />
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  )
}