'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card } from '@/components/dex/AdminDexShell';
import { formatAmount, shortenId } from '@/lib/dex/format';

interface UsersResponse {
  users: Array<{
    userId: string;
    email: string | null;
    username: string | null;
    status: string;
    swaps: number;
    swapVolume: number;
    liquidityPositions: number;
    farmStakes: number;
    openPerps: number;
    blocked: boolean;
  }>;
}

export default function AdminDexUsersPage() {
  const users = useApiResource<UsersResponse>('/api/admin/dex/users');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const rows = users.data?.users ?? [];

  const setBlocked = async (userId: string, blocked: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/users', {
        method: 'POST',
        body: { userId, action: blocked ? 'unblock' : 'block', reason: reason[userId] },
      });
      setMessage({ ok: true, text: blocked ? 'Account unblocked.' : 'Account blocked from every TigerSwap settlement path.' });
      users.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the block state.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Users"
      subtitle="Accounts that have used TigerSwap. A block is a wallet blacklist entry that every settlement path checks before it moves funds."
    >
      <AdminMessage message={message} />

      <Card title="DEX users">
        {users.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading users…</p>}
        {users.error && <p className="text-sm text-red-600 dark:text-red-400">{users.error}</p>}
        {!users.loading && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No account has used TigerSwap yet.</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-slate-400">
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">User</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Email</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Swaps</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Swap volume</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">LP</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Farm stakes</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Open perps</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">State</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <tr key={user.userId}>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {user.username || shortenId(user.userId)}
                      <span className="ml-1 text-xs text-gray-400">{shortenId(user.userId)}</span>
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{user.email ?? '—'}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{user.swaps}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(user.swapVolume)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{user.liquidityPositions}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{user.farmStakes}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{user.openPerps}</td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {user.blocked ? (
                        <span className="rounded bg-red-100 px-1 text-xs text-red-700">blocked</span>
                      ) : (
                        <span className="text-xs text-gray-500">{user.status}</span>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                      <div className="flex items-center justify-end gap-1">
                        {!user.blocked && (
                          <input
                            className="w-28 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                            placeholder="reason"
                            value={reason[user.userId] ?? ''}
                            onChange={(event) => setReason((current) => ({ ...current, [user.userId]: event.target.value }))}
                          />
                        )}
                        <button
                          onClick={() => setBlocked(user.userId, user.blocked)}
                          disabled={busy}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                        >
                          {user.blocked ? 'Unblock' : 'Block'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AdminDexShell>
  );
}
