'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Lock, Unlock } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface LockStatus {
  lock: { amount: number; unlockAt: string; votingPower: number; shareOfTotal: number } | null;
}

interface GaugesResponse {
  epoch: number;
  gauges: Array<{ gauge_id: string; pool_id: string; weight: number; emission_bps: number; status: string }>;
  bribes: Array<{ bribe_id: string; gauge_id: string; token: string; amount: number; sponsor: string; epoch: number }>;
}

export default function DexVeTgrPage() {
  const status = useApiResource<LockStatus>('/api/dex/veTGR');
  const gauges = useApiResource<GaugesResponse>('/api/dex/gauges');

  const [amount, setAmount] = useState('');
  const [lockDays, setLockDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const lock = status.data?.lock ?? null;
  const matured = lock ? new Date(lock.unlockAt).getTime() <= Date.now() : false;

  const createLock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ lock: { amount: number; votingPower: number } }>('/api/dex/veTGR', {
        method: 'POST',
        body: { amount: Number(amount), lockDays: Number(lockDays) },
      });
      setMessage({
        ok: true,
        text: `Locked ${formatAmount(body.lock.amount)} TGR for ${formatNumber(body.lock.votingPower, 4)} veTGR of voting power.`,
      });
      setAmount('');
      status.reload();
      gauges.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the lock.' });
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ released: number }>('/api/dex/veTGR', { method: 'DELETE' });
      setMessage({ ok: true, text: `Released ${formatAmount(body.released)} TGR.` });
      status.reload();
      gauges.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not release the lock.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="veTGR"
      subtitle="Lock TGR to receive voting power over which pools receive emissions, and to share in protocol fees."
      actions={
        <button
          onClick={() => {
            status.reload();
            gauges.reload();
          }}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {message && (
        <p
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            message.ok
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Your lock">
          {status.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
          {status.error && <p className="text-sm text-red-600 dark:text-red-400">{status.error}</p>}
          {!status.loading && !lock && (
            <p className="mb-3 text-sm text-gray-500 dark:text-slate-400">
              You hold no veTGR lock. Lock TGR to gain voting power.
            </p>
          )}
          {lock && (
            <div className="mb-3 space-y-2 text-sm">
              <Row label="Locked" value={`${formatAmount(lock.amount)} TGR`} />
              <Row label="Voting power" value={formatNumber(lock.votingPower, 4)} />
              <Row label="Share of all locks" value={formatPercent(lock.shareOfTotal)} />
              <Row label="Unlocks at" value={new Date(lock.unlockAt).toLocaleString()} />
            </div>
          )}

          <label className="block text-xs text-gray-500 dark:text-slate-400">Amount (TGR)</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Lock duration (days)</label>
          <input
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min="1"
            value={lockDays}
            onChange={(event) => setLockDays(event.target.value)}
          />

          <div className="flex gap-2">
            <button
              onClick={createLock}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Lock
            </button>
            <button
              onClick={release}
              disabled={busy || !lock || !matured}
              title={matured ? 'Release the matured lock' : 'The lock has not matured yet'}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Unlock className="h-4 w-4" /> Release
            </button>
          </div>
        </Panel>

        <Panel title={`Gauges · epoch ${gauges.data?.epoch ?? '—'}`} className="lg:col-span-2">
          {gauges.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading gauges…</p>}
          {gauges.error && <p className="text-sm text-red-600 dark:text-red-400">{gauges.error}</p>}
          {!gauges.loading && (gauges.data?.gauges ?? []).length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No gauge exists yet. An administrator creates a gauge for a farm's pool.
            </p>
          )}
          {(gauges.data?.gauges ?? []).length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pool</Th>
                  <Th right>Weight</Th>
                  <Th right>Emission</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(gauges.data?.gauges ?? []).map((gauge) => (
                  <tr key={gauge.gauge_id}>
                    <Td>
                      {shortenId(gauge.pool_id)}
                      <span className="ml-2 text-xs text-gray-400">{shortenId(gauge.gauge_id)}</span>
                    </Td>
                    <Td right>{formatNumber(gauge.weight, 4)}</Td>
                    <Td right>{formatPercent(gauge.emission_bps / 10_000)}</Td>
                    <Td>{gauge.status}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}

          {(gauges.data?.bribes ?? []).length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                Bribes for this epoch
              </h3>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Gauge</Th>
                    <Th>Token</Th>
                    <Th right>Amount</Th>
                    <Th>Sponsor</Th>
                  </tr>
                </thead>
                <tbody>
                  {(gauges.data?.bribes ?? []).map((bribe) => (
                    <tr key={bribe.bribe_id}>
                      <Td>{shortenId(bribe.gauge_id)}</Td>
                      <Td>{bribe.token}</Td>
                      <Td right>{formatAmount(bribe.amount)}</Td>
                      <Td>{shortenId(bribe.sponsor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Panel>
      </div>
    </DexShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-slate-100">{value}</span>
    </div>
  );
}
