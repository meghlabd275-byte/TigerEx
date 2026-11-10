'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent } from '@/lib/dex/format';

interface Assessment {
  score: number;
  impact: number;
  shouldProtect: boolean;
  reason: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  protectionEnabled: boolean;
}

interface PrivateOrder {
  orderId: string;
  batchId: string;
  commitment: string;
  sequence: number;
  status: string;
}

interface Batch {
  batchId: string;
  entries: Array<{ orderId: string; commitment: string; sequence: number; status: string }>;
}

interface Settlement {
  batchId: string;
  settled: number;
  failed: number;
  results: Array<{ orderId: string; status: string; amountOut?: number; reason?: string }>;
}

export default function DexMevPage() {
  const [form, setForm] = useState({ tokenIn: 'RUSD', tokenOut: 'TGR', amountIn: '1000' });
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [order, setOrder] = useState<PrivateOrder | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const scan = useApiResource<{ scan: { detected: boolean; attackers: string[]; victim: string | null; observations: number } }>(
    '/api/dex/mev?scan=sandwich',
  );

  const query = new URLSearchParams(form).toString();

  const run = async (kind: 'assess' | 'submit' | 'reveal' | 'settle') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'assess') {
        const result = await apiRequest<{ assessment: Assessment }>(`/api/dex/mev?${query}`);
        setAssessment(result.assessment);
      } else if (kind === 'submit') {
        const result = await apiRequest<{ order: PrivateOrder }>('/api/dex/mev', {
          method: 'POST',
          body: { tokenIn: form.tokenIn, tokenOut: form.tokenOut, amountIn: Number(form.amountIn) },
        });
        setOrder(result.order);
        setMessage({ ok: true, text: 'Order committed to the private path.' });
      } else if (kind === 'reveal' && order) {
        const result = await apiRequest<{ batch: Batch }>('/api/dex/mev', {
          method: 'PUT',
          body: { batchId: order.batchId, action: 'reveal' },
        });
        setBatch(result.batch);
        setSettlement(null);
        setMessage({ ok: true, text: 'Batch revealed; its order is now fixed and can be settled.' });
      } else if (kind === 'settle' && batch) {
        const result = await apiRequest<{ settlement: Settlement }>('/api/dex/mev', {
          method: 'PUT',
          body: { batchId: batch.batchId, action: 'settle' },
        });
        setSettlement(result.settlement);
        setMessage({
          ok: result.settlement.failed === 0,
          text: `${result.settlement.settled} order(s) settled, ${result.settlement.failed} failed.`,
        });
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The request was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="MEV shield"
      subtitle="Score a swap against the venue's real pools, then route it through TigerSwap's own private order path so a searcher cannot front-run it."
      actions={
        <button
          onClick={scan.reload}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Rescan
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

      <Panel title="Assess a swap" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Token in</span>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={form.tokenIn}
              onChange={(event) => setForm({ ...form, tokenIn: event.target.value.toUpperCase() })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Token out</span>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={form.tokenOut}
              onChange={(event) => setForm({ ...form, tokenOut: event.target.value.toUpperCase() })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Amount in</span>
            <input
              type="number"
              min="0"
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={form.amountIn}
              onChange={(event) => setForm({ ...form, amountIn: event.target.value })}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              onClick={() => run('assess')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-40"
            >
              {busy === 'assess' && <Loader2 className="h-4 w-4 animate-spin" />} Assess
            </button>
            <button
              onClick={() => run('submit')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {busy === 'submit' && <Loader2 className="h-4 w-4 animate-spin" />} Private order
            </button>
          </div>
        </div>

        {assessment && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Risk score</p>
              <p className="text-lg font-semibold">{formatNumber(assessment.score, 4)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Price impact</p>
              <p className="text-lg font-semibold">{formatPercent(assessment.impact)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Verdict</p>
              <p className="text-lg font-semibold">{assessment.shouldProtect ? 'Protect' : 'Public path'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Protection</p>
              <p className="text-lg font-semibold">{assessment.protectionEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            <p className="sm:col-span-4 text-sm text-gray-500 dark:text-slate-400">{assessment.reason}</p>
          </div>
        )}
      </Panel>

      <Panel title="Your private order" className="mb-4">
        {!order && <p className="text-sm text-gray-500 dark:text-slate-400">No private order has been committed yet.</p>}
        {order && (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-gray-500 dark:text-slate-400">Order: </span>
              {order.orderId}
            </p>
            <p>
              <span className="text-gray-500 dark:text-slate-400">Commitment: </span>
              {order.commitment}
            </p>
            <p>
              <span className="text-gray-500 dark:text-slate-400">Batch: </span>
              {order.batchId} (sequence {order.sequence})
            </p>
            <button
              onClick={() => run('reveal')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:opacity-40"
            >
              {busy === 'reveal' && <Loader2 className="h-4 w-4 animate-spin" />} Reveal batch
            </button>
          </div>
        )}
        {batch && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Sequence</Th>
                <Th>Order</Th>
                <Th>Commitment</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {batch.entries.map((entry) => (
                <tr key={entry.orderId}>
                  <Td right>{entry.sequence}</Td>
                  <Td>{entry.orderId}</Td>
                  <Td>{entry.commitment}</Td>
                  <Td>{entry.status}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {batch && (
          <button
            onClick={() => run('settle')}
            disabled={busy !== null || batch.entries.every((entry) => entry.status !== 'revealed')}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:opacity-40"
          >
            {busy === 'settle' && <Loader2 className="h-4 w-4 animate-spin" />} Settle batch
          </button>
        )}
        {settlement && (
          <div className="mt-3 text-sm">
            <p>
              {settlement.settled} settled, {settlement.failed} failed.
            </p>
            {settlement.results.map((result) => (
              <p key={result.orderId} className="text-gray-500 dark:text-slate-400">
                {result.orderId}: {result.status}
                {result.amountOut !== undefined ? ` — received ${formatAmount(result.amountOut)}` : ''}
                {result.reason ? ` — ${result.reason}` : ''}
              </p>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Recent sandwich scan">
        {scan.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Scanning settled swaps…</p>}
        {scan.error && <p className="text-sm text-red-600 dark:text-red-400">{scan.error}</p>}
        {scan.data && (
          <div className="text-sm">
            <p>
              {scan.data.scan.detected
                ? `A sandwich was detected among ${scan.data.scan.observations} settled swaps.`
                : `No sandwich among the last ${scan.data.scan.observations} settled swaps.`}
            </p>
            {scan.data.scan.attackers.length > 0 && (
              <p className="mt-1 text-gray-500 dark:text-slate-400">Attackers: {scan.data.scan.attackers.join(', ')}</p>
            )}
            {scan.data.scan.victim && <p className="text-gray-500 dark:text-slate-400">Victim: {scan.data.scan.victim}</p>}
          </div>
        )}
      </Panel>
    </DexShell>
  );
}
