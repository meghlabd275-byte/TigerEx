'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface BotInstance {
  instanceId: string;
  botType: string;
  poolId: string | null;
  params: Record<string, unknown>;
  status: string;
}

interface Opportunity {
  buyPoolId: string;
  sellPoolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  profit: number;
  profitRate: number;
}

interface Liquidation {
  positionId: string;
  asset: string;
  collateralAsset: string | null;
  borrowed: number;
  healthFactor: number;
  bounty: number;
}

interface BotsResponse {
  instances: BotInstance[];
  opportunities: Opportunity[];
  liquidations: Liquidation[];
}

const BOT_TYPES = [
  'arbitrage',
  'market_maker',
  'grid',
  'infinity_grid',
  'dca',
  'martingale',
  'twap',
  'rebalance',
  'liquidation',
] as const;

// The strategies whose step settles a real swap, so the Run control is offered.
const SETTLING_BOTS = new Set(['grid', 'infinity_grid', 'dca', 'martingale', 'twap']);

export default function DexBotsPage() {
  const bots = useApiResource<BotsResponse>('/api/dex/bots');
  const [botType, setBotType] = useState<string>('grid');
  const [params, setParams] = useState(
    '{"lowerPrice":1500,"upperPrice":2500,"levels":5,"orderSize":100,"tokenIn":"RUSD","tokenOut":"ETH"}',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      await apiRequest('/api/dex/bots', { method: 'POST', body });
      setMessage({ ok: true, text: `${label} completed.` });
      bots.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The request was refused.' });
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(params) as Record<string, unknown>;
    } catch {
      setMessage({ ok: false, text: 'Parameters must be valid JSON.' });
      return;
    }
    void send('create', { action: 'create', botType, params: parsed });
  };

  const instances = bots.data?.instances ?? [];
  const opportunities = bots.data?.opportunities ?? [];
  const liquidations = bots.data?.liquidations ?? [];

  return (
    <DexShell
      title="Trading bots"
      subtitle="Arbitrage, market-making, grid, infinity grid, DCA, martingale, TWAP, rebalancing and liquidation strategies that trade only TigerSwap's own pools. Parameters are validated by the same planner the bot runs with, and a step settles a real swap through the normal swap path."
      actions={
        <button
          onClick={bots.reload}
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

      <Panel title="Create a bot" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Strategy</span>
            <select
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={botType}
              onChange={(event) => setBotType(event.target.value)}
            >
              {BOT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Parameters (JSON)</span>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={params}
              onChange={(event) => setParams(event.target.value)}
            />
          </label>
        </div>
        <button
          onClick={create}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-40"
        >
          {busy === 'create' && <Loader2 className="h-4 w-4 animate-spin" />} Create bot
        </button>
      </Panel>

      <Panel title="Your bots" className="mb-4">
        {bots.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading bots…</p>}
        {bots.error && <p className="text-sm text-red-600 dark:text-red-400">{bots.error}</p>}
        {!bots.loading && instances.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no bot instances yet.</p>
        )}
        {instances.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Strategy</Th>
                <Th>Pool</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.instanceId}>
                  <Td>{instance.botType}</Td>
                  <Td>{instance.poolId ? shortenId(instance.poolId) : '—'}</Td>
                  <Td>{instance.status}</Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() =>
                          send('status', {
                            action: 'status',
                            instanceId: instance.instanceId,
                            status: instance.status === 'active' ? 'paused' : 'active',
                          })
                        }
                        disabled={busy !== null}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {instance.status === 'active' ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => send('evaluate', { action: 'evaluate', instanceId: instance.instanceId })}
                        disabled={busy !== null}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Evaluate
                      </button>
                      {SETTLING_BOTS.has(instance.botType) && (
                        <button
                          onClick={() => send('run', { action: 'run', instanceId: instance.instanceId })}
                          disabled={busy !== null || instance.status !== 'active'}
                          className="rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                        >
                          Run step
                        </button>
                      )}
                      <button
                        onClick={() => send('delete', { action: 'delete', instanceId: instance.instanceId })}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Arbitrage opportunities" className="mb-4">
        {opportunities.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No profitable two-pool arbitrage right now; TigerSwap&apos;s pools are in agreement.
          </p>
        )}
        {opportunities.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Pair</Th>
                <Th>Buy pool</Th>
                <Th>Sell pool</Th>
                <Th right>Size</Th>
                <Th right>Profit</Th>
                <Th right>Return</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opportunity) => (
                <tr key={`${opportunity.buyPoolId}-${opportunity.sellPoolId}-${opportunity.tokenIn}`}>
                  <Td>
                    {opportunity.tokenIn}/{opportunity.tokenOut}
                  </Td>
                  <Td>{shortenId(opportunity.buyPoolId)}</Td>
                  <Td>{shortenId(opportunity.sellPoolId)}</Td>
                  <Td right>{formatAmount(opportunity.amountIn)}</Td>
                  <Td right>{formatAmount(opportunity.profit)}</Td>
                  <Td right>{formatPercent(opportunity.profitRate)}</Td>
                  <Td right>
                    <button
                      onClick={() =>
                        send('arbitrage', {
                          action: 'arbitrage',
                          tokenIn: opportunity.tokenIn,
                          tokenOut: opportunity.tokenOut,
                          buyPoolId: opportunity.buyPoolId,
                          sellPoolId: opportunity.sellPoolId,
                          maxAmountIn: opportunity.amountIn,
                        })
                      }
                      disabled={busy !== null}
                      className="rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                    >
                      Run
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Liquidatable positions">
        {liquidations.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No borrow is below its liquidation threshold.</p>
        )}
        {liquidations.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Position</Th>
                <Th>Debt asset</Th>
                <Th>Collateral</Th>
                <Th right>Health</Th>
                <Th right>Bounty</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {liquidations.map((candidate) => (
                <tr key={candidate.positionId}>
                  <Td>{shortenId(candidate.positionId)}</Td>
                  <Td>{candidate.asset}</Td>
                  <Td>{candidate.collateralAsset ?? '—'}</Td>
                  <Td right>{formatNumber(candidate.healthFactor, 4)}</Td>
                  <Td right>{formatAmount(candidate.bounty)}</Td>
                  <Td right>
                    <button
                      onClick={() =>
                        send('liquidate', {
                          action: 'liquidate',
                          positionId: candidate.positionId,
                          collateralAsset: candidate.collateralAsset,
                        })
                      }
                      disabled={busy !== null || candidate.collateralAsset === null}
                      className="rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                    >
                      Liquidate
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
