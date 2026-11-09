'use client';

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, pairLabel, shortenId } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{ poolId: string; tokens: string[]; status: string }>;
}

interface LimitOrders {
  orders: Array<{
    order_id: string;
    pool_id: string;
    side: string;
    token_in: string;
    token_out: string;
    amount_in: number;
    limit_price: number;
    status: string;
    filled_amount_out: number;
  }>;
}

interface DcaPlans {
  plans: Array<{
    plan_id: string;
    pool_id: string;
    token_in: string;
    token_out: string;
    amount_per_slice: number;
    frequency: string;
    total_slices: number;
    executed_slices: number;
    status: string;
  }>;
}

interface TwapPlans {
  plans: Array<{
    plan_id: string;
    pool_id: string;
    token_in: string;
    token_out: string;
    total_amount_in: number;
    slices: number;
    interval_ms: number;
    executed_slices: number;
    status: string;
  }>;
}

export default function DexOrdersPage() {
  const pools = useApiResource<PoolsResponse>('/api/dex/pools');
  const limits = useApiResource<LimitOrders>('/api/dex/limit-orders');
  const dca = useApiResource<DcaPlans>('/api/dex/dca');
  const twap = useApiResource<TwapPlans>('/api/dex/twap');

  const activePools = useMemo(() => (pools.data?.pools ?? []).filter((pool) => pool.status === 'active'), [pools.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => {
    limits.reload();
    dca.reload();
    twap.reload();
  };

  const cancel = async (kind: 'limit' | 'dca' | 'twap', id: string) => {
    setBusy(id);
    setMessage(null);
    const path = kind === 'limit' ? '/api/dex/limit-orders' : kind === 'dca' ? '/api/dex/dca' : '/api/dex/twap';
    const key = kind === 'limit' ? 'orderId' : 'planId';
    try {
      await apiRequest(path, { method: 'DELETE', body: { [key]: id } });
      setMessage({ ok: true, text: 'Cancelled.' });
      reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not cancel.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="Orders and automation"
      subtitle="Limit orders, DCA plans and TWAP plans. The keeper settles each when its condition is met."
      actions={
        <button
          onClick={reload}
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

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <LimitOrderForm pools={activePools} onCreated={reload} onMessage={setMessage} />
        <DcaForm pools={activePools} onCreated={reload} onMessage={setMessage} />
        <TwapForm pools={activePools} onCreated={reload} onMessage={setMessage} />
      </div>

      <Panel title="Limit orders" className="mb-4">
        {limits.error && <p className="text-sm text-red-600 dark:text-red-400">{limits.error}</p>}
        {!limits.loading && (limits.data?.orders ?? []).length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No limit order.</p>
        )}
        {(limits.data?.orders ?? []).length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Pair</Th>
                <Th>Side</Th>
                <Th right>Amount in</Th>
                <Th right>Limit price</Th>
                <Th right>Filled out</Th>
                <Th>Status</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {(limits.data?.orders ?? []).map((order) => (
                <tr key={order.order_id}>
                  <Td>{shortenId(order.order_id)}</Td>
                  <Td>
                    {order.token_in} / {order.token_out}
                  </Td>
                  <Td>{order.side}</Td>
                  <Td right>{formatAmount(order.amount_in)}</Td>
                  <Td right>{formatNumber(order.limit_price, 8)}</Td>
                  <Td right>{formatAmount(order.filled_amount_out)}</Td>
                  <Td>{order.status}</Td>
                  <Td right>
                    <button
                      onClick={() => cancel('limit', order.order_id)}
                      disabled={busy !== null || order.status !== 'open'}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="DCA plans">
          {!dca.loading && (dca.data?.plans ?? []).length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No DCA plan.</p>
          )}
          {(dca.data?.plans ?? []).length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pair</Th>
                  <Th right>Per slice</Th>
                  <Th>Frequency</Th>
                  <Th right>Progress</Th>
                  <Th>Status</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {(dca.data?.plans ?? []).map((plan) => (
                  <tr key={plan.plan_id}>
                    <Td>
                      {plan.token_in} / {plan.token_out}
                    </Td>
                    <Td right>{formatAmount(plan.amount_per_slice)}</Td>
                    <Td>{plan.frequency}</Td>
                    <Td right>
                      {plan.executed_slices} / {plan.total_slices}
                    </Td>
                    <Td>{plan.status}</Td>
                    <Td right>
                      <button
                        onClick={() => cancel('dca', plan.plan_id)}
                        disabled={busy !== null || plan.status !== 'active'}
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

        <Panel title="TWAP plans">
          {!twap.loading && (twap.data?.plans ?? []).length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No TWAP plan.</p>
          )}
          {(twap.data?.plans ?? []).length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pair</Th>
                  <Th right>Total</Th>
                  <Th right>Slices</Th>
                  <Th right>Interval</Th>
                  <Th right>Progress</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {(twap.data?.plans ?? []).map((plan) => (
                  <tr key={plan.plan_id}>
                    <Td>
                      {plan.token_in} / {plan.token_out}
                    </Td>
                    <Td right>{formatAmount(plan.total_amount_in)}</Td>
                    <Td right>{plan.slices}</Td>
                    <Td right>{formatNumber(plan.interval_ms / 1000, 0)}s</Td>
                    <Td right>
                      {plan.executed_slices} / {plan.slices}
                    </Td>
                    <Td right>
                      <button
                        onClick={() => cancel('twap', plan.plan_id)}
                        disabled={busy !== null || plan.status !== 'active'}
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
      </div>
    </DexShell>
  );
}

type Message = (value: { ok: boolean; text: string }) => void;
type Pool = { poolId: string; tokens: string[] };

function LimitOrderForm({
  pools,
  onCreated,
  onMessage,
}: {
  pools: Pool[];
  onCreated: () => void;
  onMessage: Message;
}) {
  const [poolId, setPoolId] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amountIn, setAmountIn] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const pool = pools.find((entry) => entry.poolId === poolId) ?? pools[0] ?? null;
  const tokenIn = side === 'buy' ? pool?.tokens[1] : pool?.tokens[0];
  const tokenOut = side === 'buy' ? pool?.tokens[0] : pool?.tokens[1];

  const submit = async () => {
    if (!pool || !tokenIn || !tokenOut) return;
    setBusy(true);
    try {
      await apiRequest('/api/dex/limit-orders', {
        method: 'POST',
        body: {
          poolId: pool.poolId,
          side,
          tokenIn,
          tokenOut,
          amountIn: Number(amountIn),
          limitPrice: Number(limitPrice),
        },
      });
      onMessage({ ok: true, text: 'Limit order created.' });
      setAmountIn('');
      setLimitPrice('');
      onCreated();
    } catch (error) {
      onMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the order.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New limit order">
      <PoolSelect pools={pools} value={pool?.poolId ?? ''} onChange={setPoolId} />
      <label className="block text-xs text-gray-500 dark:text-slate-400">Side</label>
      <select
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        value={side}
        onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}
      >
        <option value="buy">Buy (spend quote)</option>
        <option value="sell">Sell (spend base)</option>
      </select>
      <Field label={`Amount in (${tokenIn ?? '—'})`} value={amountIn} onChange={setAmountIn} />
      <Field label={`Limit price (${tokenOut ?? '—'} per ${tokenIn ?? '—'})`} value={limitPrice} onChange={setLimitPrice} />
      <SubmitButton label="Create limit order" busy={busy} disabled={!pool} onClick={submit} />
    </Panel>
  );
}

function DcaForm({ pools, onCreated, onMessage }: { pools: Pool[]; onCreated: () => void; onMessage: Message }) {
  const [poolId, setPoolId] = useState('');
  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [amountPerSlice, setAmountPerSlice] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [totalSlices, setTotalSlices] = useState('');
  const [busy, setBusy] = useState(false);

  const pool = pools.find((entry) => entry.poolId === poolId) ?? pools[0] ?? null;
  const effectiveIn = tokenIn || pool?.tokens[0] || '';
  const effectiveOut = tokenOut || pool?.tokens[1] || '';

  const submit = async () => {
    if (!pool) return;
    setBusy(true);
    try {
      await apiRequest('/api/dex/dca', {
        method: 'POST',
        body: {
          poolId: pool.poolId,
          tokenIn: effectiveIn,
          tokenOut: effectiveOut,
          amountPerSlice: Number(amountPerSlice),
          frequency,
          totalSlices: Number(totalSlices),
        },
      });
      onMessage({ ok: true, text: 'DCA plan created.' });
      setAmountPerSlice('');
      setTotalSlices('');
      onCreated();
    } catch (error) {
      onMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the plan.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New DCA plan">
      <PoolSelect pools={pools} value={pool?.poolId ?? ''} onChange={setPoolId} />
      <TokenPair pool={pool} tokenIn={effectiveIn} tokenOut={effectiveOut} onIn={setTokenIn} onOut={setTokenOut} />
      <Field label={`Amount per slice (${effectiveIn || '—'})`} value={amountPerSlice} onChange={setAmountPerSlice} />
      <label className="block text-xs text-gray-500 dark:text-slate-400">Frequency</label>
      <select
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        value={frequency}
        onChange={(event) => setFrequency(event.target.value)}
      >
        <option value="hourly">Hourly</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      <Field label="Total slices" value={totalSlices} onChange={setTotalSlices} />
      <SubmitButton label="Create DCA plan" busy={busy} disabled={!pool} onClick={submit} />
    </Panel>
  );
}

function TwapForm({ pools, onCreated, onMessage }: { pools: Pool[]; onCreated: () => void; onMessage: Message }) {
  const [poolId, setPoolId] = useState('');
  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [totalAmountIn, setTotalAmountIn] = useState('');
  const [slices, setSlices] = useState('');
  const [intervalMs, setIntervalMs] = useState('60000');
  const [busy, setBusy] = useState(false);

  const pool = pools.find((entry) => entry.poolId === poolId) ?? pools[0] ?? null;
  const effectiveIn = tokenIn || pool?.tokens[0] || '';
  const effectiveOut = tokenOut || pool?.tokens[1] || '';

  const submit = async () => {
    if (!pool) return;
    setBusy(true);
    try {
      await apiRequest('/api/dex/twap', {
        method: 'POST',
        body: {
          poolId: pool.poolId,
          tokenIn: effectiveIn,
          tokenOut: effectiveOut,
          totalAmountIn: Number(totalAmountIn),
          slices: Number(slices),
          intervalMs: Number(intervalMs),
        },
      });
      onMessage({ ok: true, text: 'TWAP plan created.' });
      setTotalAmountIn('');
      setSlices('');
      onCreated();
    } catch (error) {
      onMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the plan.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="New TWAP plan">
      <PoolSelect pools={pools} value={pool?.poolId ?? ''} onChange={setPoolId} />
      <TokenPair pool={pool} tokenIn={effectiveIn} tokenOut={effectiveOut} onIn={setTokenIn} onOut={setTokenOut} />
      <Field label={`Total amount in (${effectiveIn || '—'})`} value={totalAmountIn} onChange={setTotalAmountIn} />
      <Field label="Slices" value={slices} onChange={setSlices} />
      <Field label="Interval (milliseconds)" value={intervalMs} onChange={setIntervalMs} />
      <SubmitButton label="Create TWAP plan" busy={busy} disabled={!pool} onClick={submit} />
    </Panel>
  );
}

function PoolSelect({ pools, value, onChange }: { pools: Pool[]; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label className="block text-xs text-gray-500 dark:text-slate-400">Pool</label>
      <select
        className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {pools.length === 0 && <option value="">No active pool</option>}
        {pools.map((pool) => (
          <option key={pool.poolId} value={pool.poolId}>
            {pairLabel(pool.tokens)}
          </option>
        ))}
      </select>
    </>
  );
}

function TokenPair({
  pool,
  tokenIn,
  tokenOut,
  onIn,
  onOut,
}: {
  pool: Pool | null;
  tokenIn: string;
  tokenOut: string;
  onIn: (value: string) => void;
  onOut: (value: string) => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-2 gap-2">
      <div>
        <label className="block text-xs text-gray-500 dark:text-slate-400">Spend</label>
        <select
          className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          value={tokenIn}
          onChange={(event) => onIn(event.target.value)}
        >
          {(pool?.tokens ?? []).map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 dark:text-slate-400">Receive</label>
        <select
          className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          value={tokenOut}
          onChange={(event) => onOut(event.target.value)}
        >
          {(pool?.tokens ?? []).map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label className="block text-xs text-gray-500 dark:text-slate-400">{label}</label>
      <input
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}

function SubmitButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />} {label}
    </button>
  );
}
