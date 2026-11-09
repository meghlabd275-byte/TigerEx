'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card } from '@/components/dex/AdminDexShell';
import { shortenId } from '@/lib/dex/format';

interface BotInstance {
  instanceId: string;
  userId: string;
  ownerEmail: string | null;
  botType: string;
  poolId: string | null;
  status: string;
}

interface BotsResponse {
  instances: BotInstance[];
}

const STATUSES = ['active', 'paused', 'stopped'];

/**
 * TigerSwap bot administration.
 *
 * Lists every bot instance across all users and lets an operator pause or stop
 * one. Stopping a bot is audited through the same trail every other
 * administrative action uses.
 */
export default function AdminDexBotsPage() {
  const bots = useApiResource<BotsResponse>('/api/admin/dex/bots');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setStatus = async (instanceId: string, status: string) => {
    setBusy(instanceId);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/bots', { method: 'PUT', body: { instanceId, action: 'status', status } });
      setMessage({ ok: true, text: `Bot set to ${status}.` });
      bots.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the bot status.' });
    } finally {
      setBusy(null);
    }
  };

  const instances = bots.data?.instances ?? [];

  return (
    <AdminDexShell
      title="Trading bots"
      subtitle="Every TigerSwap bot instance across all users. A bot is paused or stopped here; the engine reads the status before its next decision."
    >
      <AdminMessage message={message} />

      <Card title={`Bot instances (${instances.length})`}>
        {bots.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading bot instances…</p>}
        {bots.error && <p className="text-sm text-red-600 dark:text-red-400">{bots.error}</p>}
        {!bots.loading && instances.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No bot instances have been created yet.</p>
        )}
        {instances.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-slate-400">
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Strategy</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Owner</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Pool</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((instance) => (
                  <tr key={instance.instanceId}>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{instance.botType}</td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {instance.ownerEmail ?? shortenId(instance.userId)}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {instance.poolId ? shortenId(instance.poolId) : '—'}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{instance.status}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                      <div className="flex items-center justify-end gap-1">
                        {STATUSES.filter((status) => status !== instance.status).map((status) => (
                          <button
                            key={status}
                            onClick={() => setStatus(instance.instanceId, status)}
                            disabled={busy !== null}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                          >
                            {status}
                          </button>
                        ))}
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
