import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../../context/AuthContext'
import CountrySelector from '../../components/auth/CountrySelector'

export default function Register() {
  const navigate = useNavigate()
  const { register: registerUser, sendVerificationCode } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [step, setStep] = useState<'details' | 'verify'>('details')
  const [countryCode, setCountryCode] = useState('+1')
  const [identifier, setIdentifier] = useState('')

  const schema = z.object({
    identifier: z.string().min(1, 'Email or phone required'),
    password: z.string().min(8, 'Password must be 8+ characters'),
    confirmPassword: z.string(),
    terms: z.boolean().refine(v => v === true, 'Accept terms required')
  }).refine(d => d.password === d.confirmPassword, { message: 'Passwords must match', path: ['confirmPassword'] })

  type FormData = z.infer<typeof schema>
  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    try {
      if (step === 'details') {
        const fullPhone = data.identifier.includes('@') ? data.identifier : countryCode + data.identifier.replace(/^\+/, '')
        await sendVerificationCode(fullPhone, data.identifier.includes('@') ? 'email' : 'phone')
        setIdentifier(fullPhone)
        setStep('verify')
      }
    } catch (e) { console.error(e) }
  }

  const verifyAndRegister = async () => {
    try {
      await registerUser({ identifier, password: watch('password') })
      navigate('/dashboard')
    } catch (e) { console.error(e) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-secondary)]">
      <div className="w-full max-w-md card p-8">
        <h1 className="text-2xl font-bold text-center mb-2">Create Account</h1>
        <p className="text-center text-[var(--text-muted)] mb-6">Join TigerEx</p>

        {step === 'details' ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="text-sm">Email or Phone</label>
              <div className="flex gap-2">
                <CountrySelector value={countryCode} onChange={setCountryCode} />
                <input {...register('identifier')} className="input-field flex-1" placeholder="Enter email or phone" />
              </div>
              {errors.identifier && <p className="text-red-500 text-sm">{errors.identifier.message}</p>}
            </div>

            <div>
              <label className="text-sm">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} {...register('password')} className="input-field pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400">
                  {showPassword ? <EyeOff className="w-4" /> : <Eye className="w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-sm">{errors.password.message}</p>}
            </div>

            <div>
              <label className="text-sm">Confirm Password</label>
              <input type={showConfirm ? 'text' : 'password'} {...register('confirmPassword')} className="input-field" />
              {errors.confirmPassword && <p className="text-red-500 text-sm">{errors.confirmPassword.message}</p>}
            </div>

            <label className="flex items-center gap-2">
              <input type="checkbox" {...register('terms')} className="w-4 h-4" />
              <span className="text-sm">I agree to Terms & Conditions</span>
            </label>

            <button type="submit" className="btn-primary w-full">Continue</button>
            <p className="text-center text-sm">Already have account? <Link to="/auth/login" className="text-[var(--primary)]">Login</Link></p>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-center">Verification code sent to {identifier}</p>
            <button onClick={verifyAndRegister} className="btn-primary w-full">Verify & Continue</button>
            <button onClick={() => setStep('details')} className="btn-secondary w-full">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}