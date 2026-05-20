import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Wallet, TrendingUp, Bell, Settings, Shield } from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const [balance, setBalance] = useState(0)

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)]">
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[var(--text-muted)]">Total Balance</h3>
              <Wallet className="w-5 h-5 text-[var(--primary)]" />
            </div>
            <p className="text-3xl font-bold">${balance.toFixed(2)}</p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[var(--text-muted)]">Today's P&L</h3>
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <p className="text-3xl font-bold text-green-500">+$0.00</p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[var(--text-muted)]">Open Orders</h3>
              <Shield className="w-5 h-5 text-yellow-500" />
            </div>
            <p className="text-3xl font-bold">0</p>
          </div>
        </div>

        {user && user.kyc?.status !== 'approved' && (
          <div className="card p-4 mb-6 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500">
            <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">Complete KYC Verification</h3>
            <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">Verify your identity to enable withdrawals</p>
            <Link to="/dashboard/kyc" className="btn-primary inline-block">Complete KYC</Link>
          </div>
        )}

        <div className="card p-6">
          <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link to="/dashboard/deposit" className="p-4 border rounded-lg text-center hover:bg-[var(--bg-secondary)]">
              <p className="font-medium">Deposit</p>
            </Link>
            <Link to="/dashboard/withdraw" className="p-4 border rounded-lg text-center hover:bg-[var(--bg-secondary)]">
              <p className="font-medium">Withdraw</p>
            </Link>
            <Link to="/dashboard/transfer" className="p-4 border rounded-lg text-center hover:bg-[var(--bg-secondary)]">
              <p className="font-medium">Transfer</p>
            </Link>
            <Link to="/dashboard/settings" className="p-4 border rounded-lg text-center hover:bg-[var(--bg-secondary)]">
              <p className="font-medium">Settings</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Profile() {
  const { user, updateProfile } = useAuth()
  const [form, setForm] = useState({ firstName: '', lastName: '' })

  useEffect(() => {
    if (user?.profile) setForm({ firstName: user.profile.firstName || '', lastName: user.profile.lastName || '' })
  }, [user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await updateProfile(form)
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Profile Settings</h1>
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm">First Name</label>
                <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="input-field" />
              </div>
              <div>
                <label className="text-sm">Last Name</label>
                <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="input-field" />
              </div>
            </div>
            <button type="submit" className="btn-primary">Save Changes</button>
          </form>
        </div>
      </div>
    </div>
  )
}