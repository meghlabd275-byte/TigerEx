'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface UserSummary {
  id: string;
  email: string;
  username: string;
  kycLevel: number;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  createdAt: number;
  lastLoginAt: number;
}

interface UsersPayload {
  users?: UserSummary[];
  total?: number;
}

function formatTimestamp(value: number | undefined): string {
  if (!value) return '—';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function AdminUsersPage() {
  const users = useApiResource<UsersPayload>('/api/admin/users?limit=100');
  const list = useMemo(() => users.data?.users ?? [], [users.data]);
  const [searchTerm, setSearchTerm] = useState('');
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (user) =>
        user.email.toLowerCase().includes(term) || user.username.toLowerCase().includes(term),
    );
  }, [list, searchTerm]);

  const setStatus = async (userId: string, status: 'active' | 'suspended') => {
    setBusyUser(userId);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success !== false) {
        setMessage({ ok: true, text: `User set to ${status}.` });
        users.reload();
      } else {
        setMessage({ ok: false, text: body?.error || `Update failed (${response.status})` });
      }
    } catch {
      setMessage({ ok: false, text: 'Status update request failed.' });
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">User Management</h1>
          <button
            onClick={users.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.ok
                ? 'border border-green-200 bg-green-50 text-green-800'
                : 'border border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="mb-6 flex gap-4">
          <input
            type="text"
            placeholder="Search by email or username..."
            className="flex-1 rounded-lg border px-4 py-2"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        {users.loading && <div className="py-8 text-center text-gray-500">Loading users…</div>}
        {users.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Users are unavailable: {users.error}
          </div>
        )}

        {!users.loading && !users.error && (
          <div className="overflow-hidden rounded-lg bg-white shadow">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['User', 'Status', 'KYC Level', '2FA', 'Created', 'Last Login', 'Actions'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                      No users match the current filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((user) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4">
                        <div className="font-medium">{user.username}</div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${
                            user.locked
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {user.locked ? 'suspended' : 'active'}
                        </span>
                        {user.isAdmin && (
                          <span className="ml-2 rounded bg-purple-100 px-2 py-1 text-xs text-purple-800">
                            admin
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">{user.kycLevel}</td>
                      <td className="px-6 py-4">{user.twoFactorEnabled ? 'Enabled' : 'Disabled'}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatTimestamp(user.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {formatTimestamp(user.lastLoginAt)}
                      </td>
                      <td className="px-6 py-4">
                        {user.locked ? (
                          <button
                            disabled={busyUser === user.id}
                            onClick={() => setStatus(user.id, 'active')}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Unlock
                          </button>
                        ) : (
                          <button
                            disabled={busyUser === user.id}
                            onClick={() => setStatus(user.id, 'suspended')}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
