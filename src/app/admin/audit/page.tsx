'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface AuditLog {
  id: string;
  action?: string;
  admin_id?: string;
  resource?: string;
  resource_id?: string;
  details?: string;
  ip_address?: string;
  created_at?: string;
}

export default function AdminAuditPage() {
  const logs = useApiResource<unknown>('/api/admin/audit');
  const [action, setAction] = useState('');

  const allLogs = useMemo(() => toArray<AuditLog>(logs.data), [logs.data]);
  const filtered = useMemo(() => {
    if (!action.trim()) return allLogs;
    const needle = action.trim().toLowerCase();
    return allLogs.filter((log) => (log.action || '').toLowerCase().includes(needle));
  }, [allLogs, action]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <button
            onClick={logs.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="mb-6">
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Filter by action"
            className="w-full max-w-sm rounded-lg border px-4 py-2"
          />
        </div>

        {logs.loading && <p className="text-sm text-gray-500">Loading audit logs…</p>}
        {logs.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Audit logs are unavailable: {logs.error}
          </div>
        )}

        {!logs.loading && !logs.error && filtered.length === 0 && (
          <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
            No audit log entries.
          </div>
        )}

        {filtered.length > 0 && (
          <div className="overflow-hidden rounded-lg bg-white shadow">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3">Action</th>
                  <th className="px-6 py-3">Admin</th>
                  <th className="px-6 py-3">Resource</th>
                  <th className="px-6 py-3">IP Address</th>
                  <th className="px-6 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="px-6 py-4 text-sm text-gray-500">{log.created_at || '—'}</td>
                    <td className="px-6 py-4 font-medium">{log.action || '—'}</td>
                    <td className="px-6 py-4 text-sm">{log.admin_id || '—'}</td>
                    <td className="px-6 py-4 text-sm">
                      {log.resource || '—'}
                      {log.resource_id ? ` (${log.resource_id})` : ''}
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{log.ip_address || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{log.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
