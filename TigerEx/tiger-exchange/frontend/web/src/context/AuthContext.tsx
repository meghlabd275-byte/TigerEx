import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../services/api'

interface User {
  id: string
  email?: string
  phone?: string
  profile?: {
    firstName?: string
    lastName?: string
  }
  role: string
  preferences?: {
    theme: 'light' | 'dark' | 'system'
  }
  kyc?: {
    status: string
  }
  withdrawalsEnabled?: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  loading: boolean
  login: (data: { identifier: string; password: string; rememberMe?: boolean }) => Promise<any>
  register: (data: { identifier: string; password: string; referralCode?: string }) => Promise<void>
  logout: () => Promise<void>
  checkRegistration: (identifier: string) => Promise<{ registered: boolean }>
  verifyCode: (identifier: string, code: string) => Promise<void>
  sendVerificationCode: (type: 'email' | 'phone', identifier: string) => Promise<void>
  updateProfile: (data: any) => Promise<void>
  forgotPassword: (identifier: string) => Promise<void>
  resetPassword: (identifier: string, code: string, newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (token) {
      api.setToken(token)
      api.me().then(({ user }) => setUser(user)).catch(() => {
        localStorage.removeItem('token')
        setToken(null)
      }).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [token])

  const login = async (credentials: { identifier: string; password: string; rememberMe?: boolean }) => {
    const { data } = await api.post('/auth/login', credentials)
    if (data.accessToken) {
      if (credentials.rememberMe) {
        localStorage.setItem('token', data.accessToken)
      }
      api.setToken(data.accessToken)
      setToken(data.accessToken)
      setUser(data.user)
    }
    return data
  }

  const register = async (data: { identifier: string; password: string; referralCode?: string }) => {
    await api.post('/auth/register', data)
  }

  const logout = async () => {
    try { await api.post('/auth/logout') } catch {}
    setUser(null)
    setToken(null)
    localStorage.removeItem('token')
    api.setToken(null)
  }

  const checkRegistration = async (identifier: string) => {
    const { data } = await api.post('/auth/check-registration', { identifier })
    return data
  }

  const verifyCode = async (identifier: string, code: string) => {
    await api.post('/auth/verify-code', { identifier, code })
  }

  const sendVerificationCode = async (type: 'email' | 'phone', identifier: string) => {
    await api.post('/auth/send-verification', { identifier, type })
  }

  const updateProfile = async (updateData: any) => {
    const { data } = await api.put('/user/profile', updateData)
    setUser(data.user)
  }

  const forgotPassword = async (identifier: string) => {
    await api.post('/auth/forgot-password', { identifier })
  }

  const resetPassword = async (identifier: string, code: string, newPassword: string) => {
    await api.post('/auth/reset-password', { identifier, code, newPassword })
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, checkRegistration, verifyCode, sendVerificationCode, updateProfile, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}