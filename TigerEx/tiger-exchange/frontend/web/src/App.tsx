import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/layout/Layout'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import Dashboard from './pages/dashboard/Dashboard'
import EnhancedDashboard from './pages/dashboard/EnhancedDashboard'
import Profile from './pages/dashboard/Profile'
import AdminDashboard from './pages/admin/Dashboard'
import TradingTerminal from './pages/trading/TradingTerminal'
import WalletUI from './pages/wallet/WalletUI'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/auth/*" element={<Layout />}>
              <Route index element={<Navigate to="/auth/login" />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
            </Route>
            <Route path="/dashboard/*" element={<Layout />}>
              <Route index element={<EnhancedDashboard />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            <Route path="/trading/*" element={<Layout />}>
              <Route index element={<TradingTerminal />} />
            </Route>
            <Route path="/wallet/*" element={<Layout />}>
              <Route index element={<WalletUI />} />
            </Route>
            <Route path="/admin/*" element={<Layout />}>
              <Route index element={<AdminDashboard />} />
            </Route>
            <Route path="/" element={<Navigate to="/dashboard" />} />
          </Routes>
          <Toaster position="top-right" />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}