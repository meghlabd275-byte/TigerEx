'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, shortenId } from '@/lib/dex/format';

interface TransfersResponse {
  transfers: Array<{
    transfer_id: string;
    from_chain: string;
    to_chain: string;
    asset: string;
    amount: number;
    bridge_fee: number;
    status: string;
    deposit_tx: string | null;
    release_tx: string | null;
    created_at: string;
  }>;
}

export default function DexBridgePage() {
  const transfers = useApiResource<TransfersResponse>('/api/dex/bridge');
  const [form, setForm] = useState({ fromChain: '', toChain: '', asset: 'RUSD', amount: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = transfers.data?.transfers ?? [];

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ transfer: { transferId: string; fee: number; receives: number } }>(
        '/api/dex/bridge',
        {
          method: 'POST',
          body: {
            fromChain: form.fromChain,
            toChain: form.toChain,
            asset: form.asset,
            amount: Number(form.amount),
          },
        },
      );
      setMessage({
        ok: true,
        text: `Transfer ${shortenId(body.transfer.transferId)} locked; fee ${formatAmount(body.transfer.fee)}, the destination receives ${formatAmount(body.transfer.receives)}.`,
      });
      setForm((current) => ({ ...current, amount: '' }));
      transfers.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The transfer was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="Bridge"
      subtitle="Lock an asset on one chain and release it on another through TigerSwap's own relayer."
      actions={
        <button
          onClick={transfers.reload}
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
        <Panel title="New transfer">
          <label className="block text-xs text-gray-500 dark:text-slate-400">From chain</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.fromChain}
            onChange={(event) => setForm((current) => ({ ...current, fromChain: event.target.value.toUpperCase() }))}
            placeholder="e.g. ETH"
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">To chain</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.toChain}
            onChange={(event) => setForm((current) => ({ ...current, toChain: event.target.value.toUpperCase() }))}
            placeholder="e.g. SOL"
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Asset</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.asset}
            onChange={(event) => setForm((current) => ({ ...current, asset: event.target.value.toUpperCase() }))}
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Amount</label>
          <input
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min="0"
            value={form.amount}
            onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
          />
          <button
            onClick={submit}
            disabled={busy || !form.fromChain || !form.toChain || !form.amount}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Initiate transfer
          </button>
        </Panel>

        <Panel title="Your transfers" className="lg:col-span-2">
          {transfers.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading transfers…</p>}
          {transfers.error && <p className="text-sm text-red-600 dark:text-red-400">{transfers.error}</p>}
          {!transfers.loading && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">You have no bridge transfer.</p>
          )}
          {rows.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Transfer</Th>
                  <Th>Route</Th>
                  <Th right>Amount</Th>
                  <Th right>Fee</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transfer) => (
                  <tr key={transfer.transfer_id}>
                    <Td>{shortenId(transfer.transfer_id)}</Td>
                    <Td>
                      {transfer.from_chain} → {transfer.to_chain}
                    </Td>
                    <Td right>
                      {formatAmount(transfer.amount)} {transfer.asset}
                    </Td>
                    <Td right>{formatAmount(transfer.bridge_fee)}</Td>
                    <Td>{transfer.status}</Td>
                    <Td>{new Date(transfer.created_at).toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </DexShell>
  );
}
