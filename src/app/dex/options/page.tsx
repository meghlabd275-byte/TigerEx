'use client';

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface OptionsResponse {
  pools: Array<{
    poolId: string;
    underlying: string;
    settlementAsset: string;
    collateral: number;
    reserved: number;
    freeCollateral: number;
    feeBps: number;
    volatility: number;
    status: string;
  }>;
  positions: Array<{
    positionId: string;
    poolId: string;
    underlying: string;
    type: string;
    strike: number;
    capPrice: number;
    quantity: number;
    premium: number;
    fee: number;
    reserved: number;
    maxPayout: number;
    expiresAt: string | null;
    status: string;
    openedAt: string;
    settledAt: string | null;
    settlementPrice: number | null;
    payout: number | null;
  }>;
}

export default function DexOptionsPage() {
  const options = useApiResource<OptionsResponse>('/api/dex/options');

  const pools = useMemo(
    () => (options.data?.pools ?? []).filter((pool) => pool.status === 'active'),
    [options.data],
  );
  const positions = options.data?.positions ?? [];

  const [poolId, setPoolId] = useState('');
  const [type, setType] = useState<'call' | 'put'>('call');
  const [strike, setStrike] = useState('');
  const [capPrice, setCapPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expiryDays, setExpiryDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = pools.find((pool) => pool.poolId === poolId) ?? pools[0] ?? null;

  const buy = async () => {
    if (!selected) return;
    const strikeValue = Number(strike);
    const quantityValue = Number(quantity);
    const days = Number(expiryDays);
    if (!Number.isFinite(strikeValue) || strikeValue <= 0) {
      setMessage({ ok: false, text: 'Enter a positive strike.' });
      return;
    }
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      setMessage({ ok: false, text: 'Enter a positive quantity.' });
      return;
    }
    if (!Number.isFinite(days) || days <= 0) {
      setMessage({ ok: false, text: 'Expiry must be a positive number of days.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{
        option: { premium: number; fee: number; totalCost: number; maxPayout: number; delta: number };
      }>('/api/dex/options', {
        method: 'POST',
        body: {
          poolId: selected.poolId,
          type,
          strike: strikeValue,
          capPrice: type === 'call' && capPrice ? Number(capPrice) : undefined,
          quantity: quantityValue,
          expiry: new Date(Date.now() + days * 86_400_000).toISOString(),
        },
      });
      setMessage({
        ok: true,
        text: `Bought ${quantityValue} ${type} on ${selected.underlying}. Premium ${formatAmount(body.option.premium)} + fee ${formatAmount(body.option.fee)} ${selected.settlementAsset}, max payout ${formatAmount(body.option.maxPayout)}.`,
      });
      options.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The buy was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const settle = async (positionId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ settlement: { payout: number; settlementPrice: number } }>(
        '/api/dex/options',
        { method: 'DELETE', body: { positionId } },
      );
      setMessage({
        ok: true,
        text: `Settled at ${formatNumber(body.settlement.settlementPrice, 6)}; payout ${formatAmount(body.settlement.payout)}.`,
      });
      options.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The settlement was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const openPositions = positions.filter((position) => position.status === 'open');

  return (
    <DexShell
      title="Options AMM"
      subtitle="Buy cash-settled calls and puts from a collateral pool. Premiums are priced with Black-Scholes; the pool reserves each contract's worst-case payout."
      actions={
        <button
          onClick={options.reload}
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

      <Panel title="Pools" className="mb-4">
        {options.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
        {options.error && <p className="text-sm text-red-600 dark:text-red-400">{options.error}</p>}
        {!options.loading && pools.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No option pool exists yet. An administrator creates one from the DEX admin console.
          </p>
        )}
        {pools.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Underlying</Th>
                <Th>Settlement</Th>
                <Th right>Collateral</Th>
                <Th right>Free</Th>
                <Th right>Fee</Th>
                <Th right>Volatility</Th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={pool.poolId}>
                  <Td>{pool.underlying}</Td>
                  <Td>{pool.settlementAsset}</Td>
                  <Td right>{formatAmount(pool.collateral)}</Td>
                  <Td right>{formatAmount(pool.freeCollateral)}</Td>
                  <Td right>{formatPercent(pool.feeBps / 10_000)}</Td>
                  <Td right>{formatPercent(pool.volatility)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {selected && (
        <Panel title="Buy an option" className="mb-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-slate-400">Pool</span>
              <select
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={selected.poolId}
                onChange={(event) => setPoolId(event.target.value)}
              >
                {pools.map((pool) => (
                  <option key={pool.poolId} value={pool.poolId}>
                    {pool.underlying}/{pool.settlementAsset}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-slate-400">Type</span>
              <select
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={type}
                onChange={(event) => setType(event.target.value as 'call' | 'put')}
              >
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-slate-400">Strike</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={strike}
                onChange={(event) => setStrike(event.target.value)}
              />
            </label>
            {type === 'call' && (
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-slate-400">Payout cap (optional)</span>
                <input
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  type="number"
                  min="0"
                  value={capPrice}
                  onChange={(event) => setCapPrice(event.target.value)}
                />
              </label>
            )}
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-slate-400">Quantity</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-500 dark:text-slate-400">Expiry (days)</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="1"
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value)}
              />
            </label>
          </div>
          <button
            onClick={buy}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Buy option
          </button>
        </Panel>
      )}

      <Panel title="Your open positions" className="mb-4">
        {!options.loading && openPositions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no open option.</p>
        )}
        {openPositions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Position</Th>
                <Th>Type</Th>
                <Th right>Strike</Th>
                <Th right>Quantity</Th>
                <Th right>Premium</Th>
                <Th right>Max payout</Th>
                <Th>Expires</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {openPositions.map((position) => (
                <tr key={position.positionId}>
                  <Td>
                    {position.underlying}
                    <span className="ml-2 text-xs text-gray-400">{shortenId(position.positionId)}</span>
                  </Td>
                  <Td className="uppercase">{position.type}</Td>
                  <Td right>{formatNumber(position.strike, 6)}</Td>
                  <Td right>{formatAmount(position.quantity)}</Td>
                  <Td right>{formatAmount(position.premium)}</Td>
                  <Td right>{formatAmount(position.maxPayout)}</Td>
                  <Td>{position.expiresAt ? new Date(position.expiresAt).toLocaleString() : '—'}</Td>
                  <Td right>
                    <button
                      onClick={() => settle(position.positionId)}
                      disabled={busy}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Settle
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Settlement history">
        {positions.filter((position) => position.status === 'settled').length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">No option has settled yet.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Position</Th>
                <Th>Type</Th>
                <Th right>Strike</Th>
                <Th right>Settlement</Th>
                <Th right>Payout</Th>
                <Th>Settled at</Th>
              </tr>
            </thead>
            <tbody>
              {positions
                .filter((position) => position.status === 'settled')
                .map((position) => (
                  <tr key={position.positionId}>
                    <Td>{position.underlying}</Td>
                    <Td className="uppercase">{position.type}</Td>
                    <Td right>{formatNumber(position.strike, 6)}</Td>
                    <Td right>{position.settlementPrice === null ? '—' : formatNumber(position.settlementPrice, 6)}</Td>
                    <Td right>{position.payout === null ? '—' : formatAmount(position.payout)}</Td>
                    <Td>{position.settledAt ? new Date(position.settledAt).toLocaleString() : '—'}</Td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
