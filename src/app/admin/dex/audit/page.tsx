'use client';

import { useApiResource } from '@/lib/useApiResource';
import { AdminDexShell, Card } from '@/components/dex/AdminDexShell';
import { shortenId } from '@/lib/dex/format';

interface AuditResponse {
  entries: Array<{
    entryId: string;
    adminId: string;
    adminEmail: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    detail: unknown;
    createdAt: string;
  }>;
}

export default function AdminDexAuditPage() {
  const audit = useApiResource<AuditResponse>('/api/admin/dex/audit?limit=500');
  const entries = audit.data?.entries ?? [];

  return (
    <AdminDexShell
      title="Audit trail"
      subtitle="Append-only record of every TigerSwap administrative action. Nothing in this console updates or deletes an entry."
    >
      <Card
        title={`DEX actions (${entries.length})`}
        actions={
          <button
            onClick={audit.reload}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
        }
      >
        {audit.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading the trail…</p>}
        {audit.error && <p className="text-sm text-red-600 dark:text-red-400">{audit.error}</p>}
        {!audit.loading && entries.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No TigerSwap administrative action has been recorded yet.</p>
        )}
        {entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-slate-400">
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">When</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Admin</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Action</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Target</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.entryId}>
                    <td className="border-b border-gray-100 px-2 py-1 whitespace-nowrap dark:border-slate-800/60">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{entry.adminEmail}</td>
                    <td className="border-b border-gray-100 px-2 py-1 font-mono text-xs dark:border-slate-800/60">{entry.action}</td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {entry.targetType ? `${entry.targetType} ${shortenId(entry.targetId ?? '')}` : '—'}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 font-mono text-xs text-gray-500 dark:border-slate-800/60 dark:text-slate-400">
                      {entry.detail ? JSON.stringify(entry.detail) : '—'}
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
