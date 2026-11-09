'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent } from '@/lib/dex/format';

type Action = 'supply' | 'withdraw' | 'borrow' | 'repay' | 'flash-loan';

interface MarginResponse {
  markets: Array<{
    marketId: string;
    asset: string;
    ltv: number;
    liquidationThreshold: number;
    liquidationBonus: number;
    totalSupply: number;
    totalBorrow: number;
    supplyCap: number;
    borrowCap: number;
    status: string;
    utilization: number;
    borrowRate: number;
    supplyRate: number;
  }>;
  positions: Array<{
    positionId: string;
    asset: string;
    supplied: number;
    borrowed: number;
    collateral: number;
    healthFactor: number | null;
  }>;
}

export default function DexMarginPage() {
  const margin = useApiResource<MarginResponse>('/api/dex/margin');
  const [action, setAction] = useState<Action>('supply');
  const [asset, setAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [collateralAsset, setCollateralAsset] = useState('');
  const [collateralAmount, setCollateralAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const markets = margin.data?.markets ?? [];
  const positions = margin.data?.positions ?? [];
  const selected = markets.find((market) => market.asset === asset) ?? markets[0] ?? null;
  const needsCollateral = action === 'borrow';

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ result: unknown }>('/api/dex/margin', {
        method: 'POST',
        body: {
          action,
          asset: selected?.asset ?? asset,
          amount: Number(amount),
          collateralAsset: needsCollateral ? collateralAsset : undefined,
          collateralAmount: needsCollateral ? Number(collateralAmount) : undefined,
        },
      });
      setMessage({ ok: true, text: `${action} submitted: ${JSON.stringify(body.result)}` });
      setAmount('');
      setCollateralAmount('');
      margin.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The request was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="Margin and lending"
      subtitle="Supply assets to earn interest, or borrow against collateral. Rates follow the market's utilisation."
      actions={
        <button
          onClick={margin.reload}
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
        <Panel title="Manage a position">
          {!margin.loading && markets.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No lending market exists. An administrator lists markets from the margin admin console.
            </p>
          )}
          {markets.length > 0 && (
            <>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Action</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={action}
                onChange={(event) => setAction(event.target.value as Action)}
              >
                <option value="supply">Supply</option>
                <option value="withdraw">Withdraw supply</option>
                <option value="borrow">Borrow</option>
                <option value="repay">Repay</option>
                <option value="flash-loan">Flash loan</option>
              </select>

              <label className="block text-xs text-gray-500 dark:text-slate-400">Asset</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={selected?.asset ?? ''}
                onChange={(event) => setAsset(event.target.value)}
              >
                {markets.map((market) => (
                  <option key={market.marketId} value={market.asset}>
                    {market.asset}
                  </option>
                ))}
              </select>

              <label className="block text-xs text-gray-500 dark:text-slate-400">Amount</label>
              <input
                className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />

              {needsCollateral && (
                <>
                  <label className="block text-xs text-gray-500 dark:text-slate-400">Collateral asset</label>
                  <input
                    className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    value={collateralAsset}
                    onChange={(event) => setCollateralAsset(event.target.value.toUpperCase())}
                    placeholder="e.g. BTC"
                  />
                  <label className="block text-xs text-gray-500 dark:text-slate-400">Collateral amount</label>
                  <input
                    className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="number"
                    min="0"
                    value={collateralAmount}
                    onChange={(event) => setCollateralAmount(event.target.value)}
                  />
                </>
              )}

              <button
                onClick={submit}
                disabled={busy || !selected}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit
              </button>
            </>
          )}
        </Panel>

        <Panel title="Lending markets" className="lg:col-span-2">
          {markets.length === 0 && !margin.loading && <p className="text-sm text-gray-500 dark:text-slate-400">No market.</p>}
          {markets.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th right>LTV</Th>
                  <Th right>Liquidation threshold</Th>
                  <Th right>Supplied</Th>
                  <Th right>Borrowed</Th>
                  <Th right>Utilisation</Th>
                  <Th right>Borrow APR</Th>
                  <Th right>Supply APR</Th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.marketId}>
                    <Td>{market.asset}</Td>
                    <Td right>{formatPercent(market.ltv)}</Td>
                    <Td right>{formatPercent(market.liquidationThreshold)}</Td>
                    <Td right>{formatAmount(market.totalSupply)}</Td>
                    <Td right>{formatAmount(market.totalBorrow)}</Td>
                    <Td right>{formatPercent(market.utilization)}</Td>
                    <Td right>{formatPercent(market.borrowRate)}</Td>
                    <Td right>{formatPercent(market.supplyRate)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Panel title="Your positions" className="mt-4">
        {!margin.loading && positions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no lending position.</p>
        )}
        {positions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th right>Supplied</Th>
                <Th right>Borrowed</Th>
                <Th right>Collateral</Th>
                <Th right>Health factor</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.positionId}>
                  <Td>{position.asset}</Td>
                  <Td right>{formatAmount(position.supplied)}</Td>
                  <Td right>{formatAmount(position.borrowed)}</Td>
                  <Td right>{formatAmount(position.collateral)}</Td>
                  <Td
                    right
                    className={
                      position.healthFactor !== null && position.healthFactor < 1 ? 'font-semibold text-red-600' : ''
                    }
                  >
                    {position.healthFactor === null ? '—' : formatNumber(position.healthFactor, 4)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
