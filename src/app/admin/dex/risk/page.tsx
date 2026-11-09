'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';

interface RiskResponse {
  controls: Array<{ scope: string; paused: number; reason: string | null; updated_by: string | null; updated_at: string | null }>;
  blacklist: Array<{ entry_id: string; kind: string; value: string; reason: string | null; created_by: string | null; created_at: string | null }>;
}

const SCOPES = ['dex', 'dex_perps', 'dex_margin', 'dex_bridge'];
const BLACKLIST_KINDS = ['token', 'wallet', 'pool'];

/**
 * DEX emergency controls.
 *
 * A pause writes the `exchange_controls` row the settlement path reads, so it
 * takes effect on the next request. The blacklist is enforced by the swap and
 * lending paths. Every change is audited.
 */
export default function AdminDexRiskPage() {
  const risk = useApiResource<RiskResponse>('/api/admin/dex/risk');
  const [reason, setReason] = useState<Record<string, string>>({});
  const [kind, setKind] = useState('token');
  const [value, setValue] = useState('');
  const [blacklistReason, setBlacklistReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const controls = risk.data?.controls ?? [];
  const blacklist = risk.data?.blacklist ?? [];
  const stateOf = (scope: string) => controls.find((control) => control.scope === scope);

  const send = async (body: Record<string, unknown>, note: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/risk', { method: 'POST', body });
      setMessage({ ok: true, text: note });
      risk.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The request failed.' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (scope: string, paused: boolean) =>
    send({ action: paused ? 'resume' : 'pause', scope, reason: reason[scope] ?? '' }, `${scope} ${paused ? 'resumed' : 'paused'}.`);

  const addBlacklist = () => {
    if (!value.trim()) {
      setMessage({ ok: false, text: 'A value is required to blacklist.' });
      return;
    }
    return send({ action: 'blacklist', kind, value: value.trim(), reason: blacklistReason }, `${kind} ${value.trim()} blacklisted.`);
  };

  return (
    <AdminDexShell
      title="Risk controls"
      subtitle="Pause the venue or a scope, and block a token, wallet or pool. A pause is read by the settlement path on the next request, so it is immediate."
    >
      <AdminMessage message={message} />

      <Card title="Emergency pause">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500 dark:text-slate-400">
                <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Scope</th>
                <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">State</th>
                <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Reason</th>
                <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Updated</th>
                <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Action</th>
              </tr>
            </thead>
            <tbody>
              {SCOPES.map((scope) => {
                const control = stateOf(scope);
                const paused = control?.paused === 1;
                return (
                  <tr key={scope}>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{scope}</td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                      {paused ? (
                        <span className="rounded bg-red-100 px-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">paused</span>
                      ) : (
                        <span className="text-xs text-gray-500 dark:text-slate-400">running</span>
                      )}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{control?.reason ?? '—'}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-xs dark:border-slate-800/60">
                      {control?.updated_by ?? '—'} {control?.updated_at ? `· ${control.updated_at}` : ''}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          className="w-32 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                          placeholder="reason"
                          value={reason[scope] ?? ''}
                          onChange={(event) => setReason((current) => ({ ...current, [scope]: event.target.value }))}
                        />
                        <button
                          onClick={() => toggle(scope, paused)}
                          disabled={busy}
                          className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                        >
                          {paused ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Blacklist an entry">
          <label className="block text-xs text-gray-500 dark:text-slate-400">Kind</label>
          <select
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {BLACKLIST_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Field label="Value (symbol, address or pool id)" value={value} onChange={setValue} />
          <Field label="Reason" value={blacklistReason} onChange={setBlacklistReason} />
          <button
            onClick={addBlacklist}
            disabled={busy}
            className="mt-2 w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Blacklist
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title={`Blacklist (${blacklist.length})`}>
            {risk.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading blacklist…</p>}
            {risk.error && <p className="text-sm text-red-600 dark:text-red-400">{risk.error}</p>}
            {!risk.loading && blacklist.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">Nothing is blacklisted.</p>
            )}
            {blacklist.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Kind</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Value</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Reason</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blacklist.map((entry) => (
                      <tr key={entry.entry_id}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{entry.kind}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{entry.value}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{entry.reason ?? '—'}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <button
                            onClick={() => send({ action: 'unblacklist', kind: entry.kind, value: entry.value }, `${entry.value} removed.`)}
                            disabled={busy}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminDexShell>
  );
}
