import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>({})
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stats').then(r => r.json()),
      fetch('/api/admin/users?limit=10').then(r => r.json())
    ]).then(([s, u]) => { setStats(s); setUsers(u.users || []); })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-center">Loading...</div>

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-500">Total Users</p>
            <p className="text-3xl font-bold">{stats.totalUsers || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-500">Active Users</p>
            <p className="text-3xl font-bold">{stats.activeUsers || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-500">Verified KYC</p>
            <p className="text-3xl font-bold">{stats.verifiedKYC || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-500">Pending KYC</p>
            <p className="text-3xl font-bold">{stats.pendingKYC || 0}</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-4 border-b flex justify-between">
            <h2 className="font-semibold">Recent Users</h2>
            <Link to="/admin/users" className="text-blue-600">View All</Link>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">Email/Phone</th>
                <th className="p-3 text-left">Role</th>
                <th className="p-3 text-left">KYC</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: any) => (
                <tr key={u._id} className="border-t">
                  <td className="p-3">{u.email || u.phone}</td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3">{u.kyc?.status || 'none'}</td>
                  <td className="p-3">{u.status}</td>
                  <td className="p-3">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/admin/users" className="bg-white p-6 rounded-lg shadow text-center hover:shadow-md">
            <p className="font-medium">Manage Users</p>
          </Link>
          <Link to="/admin/kyc" className="bg-white p-6 rounded-lg shadow text-center hover:shadow-md">
            <p className="font-medium">KYC Reviews</p>
          </Link>
          <Link to="/admin/settings" className="bg-white p-6 rounded-lg shadow text-center hover:shadow-md">
            <p className="font-medium">Settings</p>
          </Link>
          <Link to="/admin/audit" className="bg-white p-6 rounded-lg shadow text-center hover:shadow-md">
            <p className="font-medium">Audit Logs</p>
          </Link>
        </div>
      </div>
    </div>
  )
}