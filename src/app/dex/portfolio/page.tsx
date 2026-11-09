'use client';

import { RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { formatAmount, formatUsd, shortenId } from '@/lib/dex/format';

interface PortfolioResponse {
  holdings: Array<{
    currency: string;
    available: number;
    locked: number;
    priceUsd: number | null;
    valueUsd: number | null;
  }>;
  totalUsd: number;
  fullyPriced: boolean;
}

interface SwapsResponse {
  swaps: Array<{
    swap_id: string;
    pool_id: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    amount_out: number;
    fee: number;
    created_at: string;
  }>;
}

export default function DexPortfolioPage() {
  const portfolio = useApiResource<PortfolioResponse>('/api/dex/portfolio');
  const history = useApiResource<SwapsResponse>('/api/dex/history');

  const holdings = portfolio.data?.holdings ?? [];
  const swaps = history.data?.swaps ?? [];

  return (
    <DexShell
      title="Portfolio"
      subtitle="Your balances and settled TigerSwap trades. An asset with no listed price is reported as unpriced rather than valued at an invented rate."
      actions={
        <button
          onClick={() => {
            portfolio.reload();
            history.reload();
          }}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Total value</p>
          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">
            {portfolio.loading ? '—' : formatUsd(portfolio.data?.totalUsd ?? null)}
          </p>
          {portfolio.data && !portfolio.data.fullyPriced && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Some assets are unpriced and excluded from the total.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Assets held</p>
          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{holdings.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Settled swaps</p>
          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{swaps.length}</p>
        </div>
      </div>

      <Panel title="Balances" className="mb-4">
        {portfolio.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading balances…</p>}
        {portfolio.error && <p className="text-sm text-red-600 dark:text-red-400">{portfolio.error}</p>}
        {!portfolio.loading && holdings.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">Your account holds no asset.</p>
        )}
        {holdings.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th right>Available</Th>
                <Th right>Locked</Th>
                <Th right>Price</Th>
                <Th right>Value</Th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.currency}>
                  <Td>{holding.currency}</Td>
                  <Td right>{formatAmount(holding.available)}</Td>
                  <Td right>{formatAmount(holding.locked)}</Td>
                  <Td right>{holding.priceUsd === null ? 'Unpriced' : formatUsd(holding.priceUsd, 6)}</Td>
                  <Td right>{holding.valueUsd === null ? '—' : formatUsd(holding.valueUsd)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Swap history">
        {history.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading history…</p>}
        {history.error && <p className="text-sm text-red-600 dark:text-red-400">{history.error}</p>}
        {!history.loading && swaps.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have made no swap yet.</p>
        )}
        {swaps.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Swap</Th>
                <Th>Pool</Th>
                <Th right>Sent</Th>
                <Th right>Received</Th>
                <Th right>Fee</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((swap) => (
                <tr key={swap.swap_id}>
                  <Td>{shortenId(swap.swap_id)}</Td>
                  <Td>{shortenId(swap.pool_id)}</Td>
                  <Td right>
                    {formatAmount(swap.amount_in)} {swap.token_in}
                  </Td>
                  <Td right>
                    {formatAmount(swap.amount_out)} {swap.token_out}
                  </Td>
                  <Td right>{formatAmount(swap.fee)}</Td>
                  <Td>{new Date(swap.created_at).toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
