import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useThemeStore } from '../context/ThemeContext'
import { Sun, Moon, LogOut, User, Settings } from 'lucide-react'

export default function Layout() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { theme, setTheme } = useThemeStore()

  const isAuthPage = location.pathname.startsWith('/auth')
  const isDashboardPage = location.pathname.startsWith('/dashboard')
  const isAdminPage = location.pathname.startsWith('/admin')

  if (isAuthPage) {
    return <Outlet />
  }

  const NavLinks = () => (
    <>
      {isDashboardPage && (
        <nav className="bg-[var(--bg-secondary)] border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-6">
                <Link to="/dashboard" className="font-bold text-xl">TigerEx</Link>
                <div className="flex gap-4">
                  <Link to="/dashboard" className="text-sm hover:text-[var(--primary)]">Dashboard</Link>
                  <Link to="/dashboard/trade" className="text-sm hover:text-[var(--primary)]">Trade</Link>
                  <Link to="/dashboard/wallet" className="text-sm hover:text-[var(--primary)]">Wallet</Link>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2">
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
                {user && (
                  <div className="flex items-center gap-3">
                    <Link to="/dashboard/profile" className="p-2">
                      <User className="w-5 h-5" />
                    </Link>
                    <button onClick={logout} className="p-2">
                      <LogOut className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </nav>
      )}
      {isAdminPage && (
        <nav className="bg-slate-900 text-white">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-6">
                <Link to="/admin" className="font-bold text-xl">TigerEx Admin</Link>
                <div className="flex gap-4 text-sm">
                  <Link to="/admin">Dashboard</Link>
                  <Link to="/admin/users">Users</Link>
                  <Link to="/admin/kyc">KYC</Link>
                  <Link to="/admin/settings">Settings</Link>
                </div>
              </div>
              <button onClick={logout} className="p-2 text-sm">Logout</button>
            </div>
          </div>
        </nav>
      )}
      <main><Outlet /></main>
    </>
  )

  return <NavLinks />
}