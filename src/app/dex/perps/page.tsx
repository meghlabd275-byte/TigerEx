'use client';

import { useEffect, useState } from 'react';
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
  conditionalOrders: Array<{
    orderId: string;
    market: string;
    positionId: string;
    positionSide: string;
    side: string;
    type: string;
    stopPrice: number | null;
    callbackRate: number | null;
    quantity: number;
    status: string;
    createdAt: string;
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
  const [condType, setCondType] = useState<'stop_loss' | 'take_profit' | 'trailing_stop'>('stop_loss');
  const [condStop, setCondStop] = useState('');
  const [condCallback, setCondCallback] = useState('5');
  const [condQuantity, setCondQuantity] = useState('');
  const [reduceSize, setReduceSize] = useState('');
  const [reducePositionId, setReducePositionId] = useState('');
  const [condPositionId, setCondPositionId] = useState('');

  const markets = perps.data?.markets ?? [];
  const positions = perps.data?.positions ?? [];
  const conditionalOrders = perps.data?.conditionalOrders ?? [];
  const selected = markets.find((market) => market.symbol === symbol) ?? markets[0] ?? null;

  // Keep the reduce and protect selectors pointed at a position that exists, so
  // a close never leaves them addressing a position that has gone.
  useEffect(() => {
    const ids = positions.map((position) => position.positionId);
    if (ids.length === 0) {
      setReducePositionId('');
      setCondPositionId('');
      return;
    }
    if (!ids.includes(reducePositionId)) setReducePositionId(ids[0]);
    if (!ids.includes(condPositionId)) setCondPositionId(ids[0]);
  }, [perps.data, reducePositionId, condPositionId]);

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

  const reduce = async (positionId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ reduced: { closedSize: number; remainingSize: number; pnl: number; closed: boolean } }>(
        '/api/dex/perps',
        { method: 'PATCH', body: { positionId, quantity: Number(reduceSize) } },
      );
      setMessage({
        ok: true,
        text: body.reduced.closed
          ? `Reduced ${formatAmount(body.reduced.closedSize)}; the position is now closed with realised PnL ${formatAmount(body.reduced.pnl)}.`
          : `Reduced ${formatAmount(body.reduced.closedSize)}; ${formatAmount(body.reduced.remainingSize)} remains open.`,
      });
      setReduceSize('');
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The reduce was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const placeConditional = async (positionId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ order: { orderId: string; type: string } }>('/api/dex/conditional-orders', {
        method: 'POST',
        body: {
          positionId,
          type: condType,
          quantity: Number(condQuantity),
          ...(condType === 'trailing_stop' ? { callbackRate: Number(condCallback) / 100 } : { stopPrice: Number(condStop) }),
        },
      });
      setMessage({ ok: true, text: `Placed ${body.order.type} order ${body.order.orderId}; the keeper fires it when the mark crosses.` });
      setCondStop('');
      setCondQuantity('');
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The order was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const cancelConditional = async (orderId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/dex/conditional-orders', { method: 'DELETE', body: { orderId } });
      setMessage({ ok: true, text: 'The conditional order was cancelled.' });
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The cancel was refused.' });
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Reduce a position">
          {positions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Open a position before you reduce one.</p>
          ) : (
            <>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Position</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={reducePositionId}
                onChange={(event) => setReducePositionId(event.target.value)}
              >
                {positions.map((position) => (
                  <option key={position.positionId} value={position.positionId}>
                    {position.symbol} · {position.side} · {formatAmount(position.size)}
                  </option>
                ))}
              </select>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Quantity to reduce (base units)</label>
              <input
                className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={reduceSize}
                onChange={(event) => setReduceSize(event.target.value)}
              />
              <button
                onClick={() => reduce(reducePositionId)}
                disabled={busy || !reducePositionId || !reduceSize}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-orange-600 px-4 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Reduce position
              </button>
            </>
          )}
        </Panel>

        <Panel title="Protect a position">
          {positions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Open a position before you protect one.</p>
          ) : (
            <>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Position</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={condPositionId}
                onChange={(event) => setCondPositionId(event.target.value)}
              >
                {positions.map((position) => (
                  <option key={position.positionId} value={position.positionId}>
                    {position.symbol} · {position.side} · mark {formatNumber(position.markPrice, 4)}
                  </option>
                ))}
              </select>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Type</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={condType}
                onChange={(event) => setCondType(event.target.value as 'stop_loss' | 'take_profit' | 'trailing_stop')}
              >
                <option value="stop_loss">Stop-loss</option>
                <option value="take_profit">Take-profit</option>
                <option value="trailing_stop">Trailing stop</option>
              </select>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Quantity (base units)</label>
              <input
                className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={condQuantity}
                onChange={(event) => setCondQuantity(event.target.value)}
              />
              {condType === 'trailing_stop' ? (
                <>
                  <label className="block text-xs text-gray-500 dark:text-slate-400">Callback (%)</label>
                  <input
                    className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="number"
                    min="0.01"
                    max="99.99"
                    step="0.1"
                    value={condCallback}
                    onChange={(event) => setCondCallback(event.target.value)}
                  />
                </>
              ) : (
                <>
                  <label className="block text-xs text-gray-500 dark:text-slate-400">Trigger price</label>
                  <input
                    className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="number"
                    min="0"
                    value={condStop}
                    onChange={(event) => setCondStop(event.target.value)}
                  />
                </>
              )}
              <button
                onClick={() => placeConditional(condPositionId)}
                disabled={busy || !condPositionId || !condQuantity}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Place conditional order
              </button>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Your conditional orders" className="mt-4">
        {conditionalOrders.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no conditional order.</p>
        )}
        {conditionalOrders.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Market</Th>
                <Th>Type</Th>
                <Th>Position side</Th>
                <Th right>Trigger</Th>
                <Th right>Quantity</Th>
                <Th>Status</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {conditionalOrders.map((order) => (
                <tr key={order.orderId}>
                  <Td>{order.market}</Td>
                  <Td>{order.type}</Td>
                  <Td>{order.positionSide}</Td>
                  <Td right>
                    {order.type === 'trailing_stop'
                      ? `${formatNumber((order.callbackRate ?? 0) * 100, 2)}%`
                      : formatNumber(order.stopPrice ?? 0, 4)}
                  </Td>
                  <Td right>{formatAmount(order.quantity)}</Td>
                  <Td>{order.status}</Td>
                  <Td right>
                    <button
                      onClick={() => cancelConditional(order.orderId)}
                      disabled={busy || order.status !== 'pending'}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Cancel
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
