import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Mail, Phone, Loader2, ChevronDown, Chrome, Apple, KeyRound, Wallet } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import CountrySelector from '../../components/auth/CountrySelector'
import SocialButtons from '../../components/auth/SocialButtons'
import PasswordStrength from '../../components/auth/PasswordStrength'

interface LoginForm {
  identifier: string
  password: string
  rememberMe: boolean
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login, sendVerificationCode, checkRegistration } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'credentials' | 'otp' | '2fa'>('credentials')
  const [userId, setUserId] = useState('')
  const [countryCode, setCountryCode] = useState('+1')
  const [identifierType, setIdentifierType] = useState<'email' | 'phone'>('email')
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null)
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null)

  const { register, handleSubmit, watch, formState: { errors }, setError, clearErrors } = useForm<LoginForm>({
    resolver: zodResolver(z.object({
      identifier: z.string().min(1, 'Email or phone is required'),
      password: z.string().min(1, 'Password is required'),
      rememberMe: z.boolean()
    }))
  })

  const checkIdentifier = async (value: string) => {
    if (!value) return
    const normalized = value.includes('@') ? value : countryCode + value.replace(/^\+/, '')
    const res = await checkRegistration(normalized)
    setIsRegistered(res.registered)
    if (!res.registered && value.length > 0) {
      setTimeout(() => navigate('/auth/register', { state: { identifier: value } }), 500)
    }
  }

  const onSubmit = async (data: LoginForm) => {
    if (lockedUntil) return
    
    setLoading(true)
    clearErrors()

    try {
      const identifier = identifierType === 'phone' ? countryCode + data.identifier.replace(/^\+/, '') : data.identifier
      
      if (step === 'credentials') {
        const result = await login({
          identifier,
          password: data.password,
          rememberMe: data.rememberMe
        })

        if (result.requires2FA) {
          setUserId(result.userId)
          setStep('2fa')
        } else if (result.accessToken) {
          navigate('/dashboard')
        } else if (result.error) {
          setError('password', { message: result.error })
          
          if (result.attemptsRemaining !== undefined) {
            setAttempts(prev => prev + 1)
            if (result.attemptsRemaining <= 1) {
              setLockedUntil(new Date(Date.now() + 48 * 60 * 60 * 1000))
            }
          }
          
          if (result.code === 'ACCOUNT_LOCKED') {
            setLockedUntil(new Date(result.lockedUntil))
          }
        }
      }
    } catch (err: any) {
      setError('password', { message: err.message || 'Login failed' })
    } finally {
      setLoading(false)
    }
  }

  const verifyOTP = async (code: string) => {
    setLoading(true)
    try {
      const { verify2FA } = useAuth()
      await verify2FA({ userId, code })
      navigate('/dashboard')
    } catch {
      setError('password', { message: 'Invalid verification code' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (lockedUntil) {
      const interval = setInterval(() => {
        if (new Date() >= lockedUntil!) {
          setLockedUntil(null)
          setAttempts(0)
        }
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [lockedUntil])

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
      <div className="w-full max-w-md animate-fadeIn">
        <div className="card p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">TigerEx</h1>
            <p className="text-[var(--text-muted)] mt-2">Welcome back</p>
          </div>

          {step === 'credentials' ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {/* Identifier Input */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Email or Phone
                </label>
                <div className="relative">
                  {identifierType === 'phone' ? (
                    <div className="flex gap-2">
                      <CountrySelector
                        value={countryCode}
                        onChange={setCountryCode}
                        onTypeChange={setIdentifierType}
                      />
                      <input
                        type="tel"
                        placeholder="Phone number"
                        className="input-field flex-1"
                        {...register('identifier')}
                        onBlur={(e) => checkIdentifier(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)]" />
                      <input
                        type="email"
                        placeholder="email@example.com"
                        className="input-field pl-10"
                        {...register('identifier')}
                        onBlur={(e) => checkIdentifier(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex gap-3 mt-2">
                  <button
                    type="button"
                    onClick={() => setIdentifierType('email')}
                    className={`text-xs ${identifierType === 'email' ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdentifierType('phone')}
                    className={`text-xs ${identifierType === 'phone' ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`}
                  >
                    Phone
                  </button>
                </div>
                {errors.identifier && (
                  <p className="text-red-500 text-sm mt-1">{errors.identifier.message}</p>
                )}
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter password"
                    className="input-field pr-10"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-red-500 text-sm mt-1">{errors.password.message}</p>
                )}
                {lockedUntil && (
                  <p className="text-red-500 text-sm mt-1">
                    Account locked until {lockedUntil.toLocaleTimeString()}
                  </p>
                )}
              </div>

              {/* Remember Me */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    {...register('rememberMe')}
                    className="w-4 h-4 rounded border-[var(--border)]"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">Remember me for 30 days</span>
                </label>
                <Link
                  to="/auth/forgot-password"
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || lockedUntil !== null}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                {!loading && 'Sign In'}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--border)]"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-4 bg-[var(--bg-primary)] text-[var(--text-muted)]">or continue with</span>
                </div>
              </div>

              <SocialButtons />

              <p className="text-center text-sm text-[var(--text-muted)]">
                Don't have an account?{' '}
                <Link to="/auth/register" className="text-[var(--primary)] hover:underline">
                  Sign up
                </Link>
              </p>
            </form>
          ) : step === '2fa' ? (
            <OTPVerification
              onVerify={verifyOTP}
              onCancel={() => setStep('credentials')}
              loading={loading}
            />
          ) : null}

          <Link to="/" className="block text-center text-sm text-[var(--text-muted)] mt-6 hover:underline">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

function OTPVerification({ onVerify, onCancel, loading }: { onVerify: (code: string) => void, onCancel: () => void, loading: boolean }) {
  const [code, setCode] = useState(['', '', '', '', '', '', ''])
  const inputRefs = code.map(() => React.createRef<HTMLInputElement>())

  useEffect(() => {
    inputRefs[0].current?.focus()
  }, [])

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    
    const newCode = [...code]
    newCode[index] = value.slice(-1)
    setCode(newCode)

    if (value && index < 5) {
      inputRefs[index + 1].current?.focus()
    }

    if (newCode.every(c => c) && newCode.join('').length === 6) {
      onVerify(newCode.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs[index - 1].current?.focus()
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <KeyRound className="w-12 h-12 mx-auto text-[var(--primary)]" />
        <h2 className="text-xl font-semibold mt-4">Two-Factor Authentication</h2>
        <p className="text-sm text-[var(--text-muted)]">Enter the 6-digit code from your authenticator app</p>
      </div>

      <div className="flex justify-center gap-2">
        {code.map((digit, i) => (
          <input
            key={i}
            ref={inputRefs[i]}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="w-12 h-14 text-center text-xl font-bold rounded-lg border border-[var(--border)] focus:ring-2 focus:ring-[var(--primary)]"
          />
        ))}
      </div>

      <button
        onClick={() => onVerify(code.join(''))}
        disabled={loading || code.join('').length !== 6}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
        Verify
      </button>

      <button onClick={onCancel} className="btn-secondary w-full">
        Cancel
      </button>
    </div>
  )
}