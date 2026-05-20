import axios, { AxiosError, AxiosRequestConfig } from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' }
})

let token: string | null = null
api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string }>) => {
    if (error.response?.status === 401) {
      token = null
      localStorage.removeItem('token')
      window.location.href = '/auth/login'
    }
    return Promise.reject(error.response?.data?.error || error.message)
  }
)

export const setToken = (t: string | null) => { token = t }
export const getToken = () => token

export const auth = {
  login: (data: any) => api.post('/auth/login', data),
  register: (data: any) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  refresh: (refreshToken: string) => api.post('/auth/refresh', { refreshToken }),
  verify2FA: (data: any) => api.post('/auth/verify-2fa', data),
  sendVerification: (data: any) => api.post('/auth/send-verification', data),
  verifyCode: (data: any) => api.post('/auth/verify-code', data),
  resetPassword: (data: any) => api.post('/auth/reset-password', data),
  checkRegistration: (identifier: string) => api.post('/auth/check-registration', { identifier }),
  socialLogin: (provider: string, token: string) => api.post('/auth/social', { provider, accessToken: token }),
  setup2FA: () => api.post('/auth/2fa/setup'),
  confirm2FA: (code: string) => api.post('/auth/2fa/confirm', { code }),
  reset2FA: (data: any) => api.post('/auth/2fa/reset', data)
}

export const user = {
  me: () => api.get('/user/profile'),
  updateProfile: (data: any) => api.put('/user/profile', data),
  updatePreferences: (data: any) => api.put('/user/preferences', data),
  sessions: () => api.get('/user/sessions'),
  revokeSession: (id: string) => api.delete(`/user/sessions/${id}`),
  notifications: () => api.get('/user/notifications'),
  uploadDocument: (formData: FormData) => api.post('/user/upload-document', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  submitKYC: (data: any) => api.post('/user/kyc', data),
  liveness: (data: any) => api.post('/user/liveness', data),
  auditLogs: () => api.get('/user/audit-logs')
}

export const admin = {
  users: (params?: any) => api.get('/admin/users', { params }),
  user: (id: string) => api.get(`/admin/users/${id}`),
  updateUser: (id: string, data: any) => api.put(`/admin/users/${id}`, data),
  reviewKYC: (id: string, data: any) => api.post(`/admin/users/${id}/kyc`, data),
  stats: () => api.get('/admin/stats'),
  auditLogs: (params?: any) => api.get('/admin/audit-logs', { params }),
  forceLogout: (id: string) => api.post(`/admin/users/${id}/force-logout`),
  unlock: (id: string) => api.post(`/admin/users/${id}/unlock`)
}

export const countries = () => api.get('/auth/countries')

export default api