'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatNumber, shortenId } from '@/lib/dex/format';

interface HooksResponse {
  hooks: Array<{ hookId: string; poolId: string; kind: string; config: Record<string, number>; status: string }>;
}

interface PoolsResponse {
  pools: Array<{ poolId: string; tokens: string[]; status: string }>;
}

const HOOK_KINDS = ['dynamicFee', 'limitOrder', 'twamm', 'antiMev'];

/**
 * The fields each hook kind needs. They mirror the pure rules in `hooks.ts`, so
 * the form asks for exactly the parameters the rule reads and nothing more.
 */
const HOOK_FIELDS: Record<string, Array<{ key: string; label: string; value: string }>> = {
  dynamicFee: [
    { key: 'baseFee', label: 'Base fee (fraction)', value: '0.003' },
    { key: 'maxFee', label: 'Max fee (fraction)', value: '0.03' },
    { key: 'volatilityCeiling', label: 'Volatility ceiling', value: '0.05' },
  ],
  limitOrder: [
    { key: 'triggerPrice', label: 'Trigger price', value: '1' },
    { key: 'amountIn', label: 'Amount in', value: '100' },
    { key: 'side', label: 'Side (0 buy, 1 sell)', value: '0' },
  ],
  twamm: [
    { key: 'remainingIn', label: 'Remaining in', value: '1000' },
    { key: 'durationSeconds', label: 'Duration (seconds)', value: '3600' },
    { key: 'startedAt', label: 'Started at (unix)', value: '0' },
    { key: 'lastExecutedAt', label: 'Last executed at (unix)', value: '0' },
  ],
  antiMev: [{ key: 'tolerance', label: 'Tolerance (fraction)', value: '0.02' }],
};

export default function AdminDexHooksPage() {
  const hooks = useApiResource<HooksResponse>('/api/admin/dex/hooks');
  const pools = useApiResource<PoolsResponse>('/api/admin/dex/pools');
  const [poolId, setPoolId] = useState('');
  const [kind, setKind] = useState('dynamicFee');
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(HOOK_FIELDS.dynamicFee.map((field) => [field.key, field.value])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = hooks.data?.hooks ?? [];
  const fields = HOOK_FIELDS[kind] ?? [];

  const changeKind = (next: string) => {
    setKind(next);
    setConfig(Object.fromEntries((HOOK_FIELDS[next] ?? []).map((field) => [field.key, field.value])));
  };

  const attach = async () => {
    const targetPool = poolId || pools.data?.pools[0]?.poolId;
    if (!targetPool) {
      setMessage({ ok: false, text: 'Create a pool before attaching a hook.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const parsed: Record<string, number> = {};
      for (const [key, value] of Object.entries(config)) parsed[key] = Number(value);
      await apiRequest('/api/admin/dex/hooks', { method: 'POST', body: { poolId: targetPool, kind, config: parsed } });
      setMessage({ ok: true, text: `${kind} hook attached.` });
      hooks.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not attach the hook.' });
    } finally {
      setBusy(false);
    }
  };

  const detach = async (hookPoolId: string, hookKind: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ poolId: hookPoolId, kind: hookKind });
      await apiRequest(`/api/admin/dex/hooks?${params.toString()}`, { method: 'DELETE' });
      setMessage({ ok: true, text: `${hookKind} hook detached.` });
      hooks.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not detach the hook.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="V4 hooks"
      subtitle="Attach pool-local logic: a dynamic fee that widens with realised volatility, an on-chain limit order, a TWAMM schedule or an anti-MEV gate. A bad configuration is refused before it is stored."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Attach a hook">
          <label className="block text-xs text-gray-500 dark:text-slate-400">Pool</label>
          <select
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={poolId}
            onChange={(event) => setPoolId(event.target.value)}
          >
            {(pools.data?.pools ?? []).map((pool) => (
              <option key={pool.poolId} value={pool.poolId}>
                {pool.tokens.join(' / ')} · {shortenId(pool.poolId)}
              </option>
            ))}
          </select>

          <label className="block text-xs text-gray-500 dark:text-slate-400">Hook kind</label>
          <select
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={kind}
            onChange={(event) => changeKind(event.target.value)}
          >
            {HOOK_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {fields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              value={config[field.key] ?? ''}
              onChange={(value) => setConfig((current) => ({ ...current, [field.key]: value }))}
            />
          ))}

          <button
            onClick={attach}
            disabled={busy || (pools.data?.pools.length ?? 0) === 0}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Attach hook
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Attached hooks">
            {hooks.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading hooks…</p>}
            {hooks.error && <p className="text-sm text-red-600 dark:text-red-400">{hooks.error}</p>}
            {!hooks.loading && rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No hook is attached.</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Pool</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Kind</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Config</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((hook) => (
                      <tr key={hook.hookId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{shortenId(hook.poolId)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{hook.kind}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-xs dark:border-slate-800/60">
                          {Object.entries(hook.config)
                            .map(([key, value]) => `${key}=${formatNumber(value, 6)}`)
                            .join(', ')}
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{hook.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <button
                            onClick={() => detach(hook.poolId, hook.kind)}
                            disabled={busy}
                            className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            Detach
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
