'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent } from '@/lib/dex/format';

interface PerpsResponse {
  markets: Array<{
    symbol: string;
    base_asset: string;
    quote_asset: string;
    settlement_asset: string;
    contract_type: string;
    max_leverage: number;
    taker_fee_bps: number;
    maintenance_margin_rate: number;
    status: string;
    markPrice: number | null;
  }>;
  positions: Array<{
    positionId: string;
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    margin: number;
    unrealizedPnl: number;
    equity: number;
    liquidationPrice: number;
    marginMode: string;
  }>;
}

export default function DexPerpsPage() {
  const perps = useApiResource<PerpsResponse>('/api/dex/perps');
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState('2');
  const [marginMode, setMarginMode] = useState<'isolated' | 'cross'>('isolated');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const markets = perps.data?.markets ?? [];
  const positions = perps.data?.positions ?? [];
  const selected = markets.find((market) => market.symbol === symbol) ?? markets[0] ?? null;

  const open = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ position: { positionId: string; margin: number; liquidationPrice: number } }>(
        '/api/dex/perps',
        {
          method: 'POST',
          body: {
            symbol: selected.symbol,
            side,
            size: Number(size),
            leverage: Number(leverage),
            marginMode,
          },
        },
      );
      setMessage({
        ok: true,
        text: `Opened ${body.position.positionId}; margin ${formatAmount(body.position.margin)} ${selected.settlement_asset}, liquidation at ${formatNumber(body.position.liquidationPrice, 4)}.`,
      });
      setSize('');
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The position was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const close = async (positionId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ closed: { pnl: number; fee: number; released: number } }>('/api/dex/perps', {
        method: 'DELETE',
        body: { positionId },
      });
      setMessage({
        ok: true,
        text: `Closed the position; realised PnL ${formatAmount(body.closed.pnl)} and released ${formatAmount(body.closed.released)}.`,
      });
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The close was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="Perpetual futures"
      subtitle="Open a leveraged position against a listed market; margin is reserved and PnL settles in the market's settlement asset."
      actions={
        <button
          onClick={perps.reload}
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
        <Panel title="Open a position">
          {perps.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading markets…</p>}
          {perps.error && <p className="text-sm text-red-600 dark:text-red-400">{perps.error}</p>}
          {!perps.loading && markets.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No perpetual market is listed. An administrator lists markets from the futures admin console.
            </p>
          )}
          {markets.length > 0 && (
            <>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Market</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={selected?.symbol ?? ''}
                onChange={(event) => setSymbol(event.target.value)}
              >
                {markets.map((market) => (
                  <option key={market.symbol} value={market.symbol}>
                    {market.symbol} · {market.markPrice === null ? 'no mark' : formatNumber(market.markPrice, 4)}
                  </option>
                ))}
              </select>

              <div className="mb-3 flex gap-2">
                <button
                  onClick={() => setSide('long')}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                    side === 'long'
                      ? 'border-green-500 bg-green-50 font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      : 'border-gray-300 text-gray-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  Long
                </button>
                <button
                  onClick={() => setSide('short')}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                    side === 'short'
                      ? 'border-red-500 bg-red-50 font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      : 'border-gray-300 text-gray-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  Short
                </button>
              </div>

              <label className="block text-xs text-gray-500 dark:text-slate-400">Size (base units)</label>
              <input
                className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />

              <label className="block text-xs text-gray-500 dark:text-slate-400">
                Leverage (max {selected?.max_leverage ?? '—'}x)
              </label>
              <input
                className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="1"
                value={leverage}
                onChange={(event) => setLeverage(event.target.value)}
              />

              <label className="block text-xs text-gray-500 dark:text-slate-400">Margin mode</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={marginMode}
                onChange={(event) => setMarginMode(event.target.value as 'isolated' | 'cross')}
              >
                <option value="isolated">Isolated</option>
                <option value="cross">Cross</option>
              </select>

              <button
                onClick={open}
                disabled={busy || !selected}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Open position
              </button>
            </>
          )}
        </Panel>

        <Panel title="Listed markets" className="lg:col-span-2">
          {markets.length === 0 && !perps.loading && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No market is listed.</p>
          )}
          {markets.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th>Type</Th>
                  <Th right>Mark price</Th>
                  <Th right>Max leverage</Th>
                  <Th right>Taker fee</Th>
                  <Th right>Maintenance margin</Th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.symbol}>
                    <Td>{market.symbol}</Td>
                    <Td>{market.contract_type}</Td>
                    <Td right>{market.markPrice === null ? '—' : formatNumber(market.markPrice, 4)}</Td>
                    <Td right>{market.max_leverage}x</Td>
                    <Td right>{formatPercent(market.taker_fee_bps / 10_000)}</Td>
                    <Td right>{formatPercent(market.maintenance_margin_rate)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      <Panel title="Your open positions" className="mt-4">
        {!perps.loading && positions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no open position.</p>
        )}
        {positions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Symbol</Th>
                <Th>Side</Th>
                <Th right>Size</Th>
                <Th right>Entry</Th>
                <Th right>Mark</Th>
                <Th right>Leverage</Th>
                <Th right>Margin</Th>
                <Th right>Unrealised PnL</Th>
                <Th right>Equity</Th>
                <Th right>Liquidation</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.positionId}>
                  <Td>{position.symbol}</Td>
                  <Td className={position.side === 'long' ? 'text-green-600' : 'text-red-600'}>{position.side}</Td>
                  <Td right>{formatAmount(position.size)}</Td>
                  <Td right>{formatNumber(position.entryPrice, 4)}</Td>
                  <Td right>{formatNumber(position.markPrice, 4)}</Td>
                  <Td right>{position.leverage}x</Td>
                  <Td right>{formatAmount(position.margin)}</Td>
                  <Td right className={position.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatAmount(position.unrealizedPnl)}
                  </Td>
                  <Td right>{formatAmount(position.equity)}</Td>
                  <Td right>{formatNumber(position.liquidationPrice, 4)}</Td>
                  <Td right>
                    <button
                      onClick={() => close(position.positionId)}
                      disabled={busy}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Close
                    </button>
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
