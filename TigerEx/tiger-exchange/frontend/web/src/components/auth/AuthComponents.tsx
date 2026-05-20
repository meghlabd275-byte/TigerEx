<div>
  <div className="mb-2">
    <input
      {...register(field)}
      type={showPassword ? 'text' : 'password'}
      className="input-field"
      placeholder={placeholder}
    />
    <button
      type="button"
      onClick={() => setShowPassword(!showPassword)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
    >
      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
    </button>
  </div>
</div>

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function usePasswordVisibility() {
  const [showPassword, setShowPassword] = useState(false)
  return { showPassword, toggle: () => setShowPassword(!showPassword), showPassword }
}

import { useState } from 'react'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export function PasswordStrength({ password }: { password: string }) {
  const [strength, setStrength] = useState({ score: 0, label: 'weak', color: 'red' })
  
  useEffect(() => {
    if (!password) { setStrength({ score: 0, label: 'weak', color: 'red' }); return }
    let s = 0
    if (password.length >= 8) s++
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++
    if (/\d/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    
    if (s <= 1) setStrength({ score: s, label: 'Weak', color: 'red' })
    else if (s <= 2) setStrength({ score: s, label: 'Medium', color: 'yellow' })
    else setStrength({ score: s, label: 'Strong', color: 'green' })
  }, [password])

  const colors = { red: 'bg-red-500', yellow: 'bg-yellow-500', green: 'bg-green-500' }
  const widths = { 1: 'w-1/4', 2: 'w-2/4', 3: 'w-3/4', 4: 'w-full' }

  return (
    <div className="mt-2">
      <div className={`h-1 rounded-full ${colors[strength.color as keyof typeof colors]} ${widths[strength.score as keyof typeof widths]} transition-all`} />
      <p className={`text-xs mt-1 text-${strength.color === 'red' ? 'red' : strength.color === 'yellow' ? 'yellow' : 'green'}-500`}>
        {strength.label}
      </p>
    </div>
  )
}

import { useState, useEffect } from 'react'
import axios from 'axios'

export function CountrySelector({ value, onChange, onTypeChange }: { value: string, onChange: (c: string) => void, onTypeChange?: (t: any) => void }) {
  const [countries, setCountries] = useState<any[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    axios.get('/api/auth/countries').then(r => setCountries(r.data)).catch(() => {})
  }, [])

  const selected = countries.find(c => c.code === value)

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="input-field flex items-center gap-2 w-24">
        <span>{selected?.flag || '🇺🇸'}</span>
        <span className="text-xs">{value}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 max-h-64 overflow-auto bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-lg">
          {countries.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onChange(c.code); setOpen(false); onTypeChange?.('phone') }}
              className="w-full px-3 py-2 text-left hover:bg-[var(--bg-secondary)] flex gap-2"
            >
              <span>{c.flag}</span>
              <span className="text-sm">{c.name}</span>
              <span className="ml-auto text-xs text-gray-400">{c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { Chrome, Apple, KeyRound, Wallet } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export function SocialButtons() {
  const { login } = useAuth()

  const handleGoogle = async () => {
    // Google OAuth flow would go here
    console.log('Google login')
  }

  const handleApple = async () => {
    // Apple OAuth flow would go here
    console.log('Apple login')
  }

  const handleMetaMask = async () => {
    // MetaMask Web3 login would go here
    console.log('MetaMask login')
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      <button type="button" onClick={handleGoogle} className="btn-secondary flex items-center justify-center py-2">
        <Chrome className="w-5 h-5" />
      </button>
      <button type="button" onClick={handleApple} className="btn-secondary flex items-center justify-center py-2">
        <Apple className="w-5 h-5" />
      </button>
      <button type="button" className="btn-secondary flex items-center justify-center py-2">
        <KeyRound className="w-5 h-5" />
      </button>
      <button type="button" onClick={handleMetaMask} className="btn-secondary flex items-center justify-center py-2">
        <Wallet className="w-5 h-5" />
      </button>
    </div>
  )
}