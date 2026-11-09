'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, shortenId } from '@/lib/dex/format';

interface StakingResponse {
  pools: Array<{
    stakeId: string;
    name: string;
    stakeToken: string;
    receiptToken: string;
    totalStaked: number;
    totalShares: number;
    exchangeRate: number;
    redemptionFeeBps: number;
    status: string;
  }>;
  positions: Array<{
    stakeId: string;
    name: string;
    stakeToken: string;
    receiptToken: string;
    shares: number;
    exchangeRate: number;
    value: number;
  }>;
}

export default function DexLiquidStakingPage() {
  const staking = useApiResource<StakingResponse>('/api/dex/liquid-staking');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = staking.data?.pools ?? [];
  const positions = staking.data?.positions ?? [];

  const act = async (stakeId: string, action: 'stake' | 'unstake') => {
    setBusy(`${stakeId}:${action}`);
    setMessage(null);
    try {
      const value = Number(amounts[stakeId]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a positive amount.');
      if (action === 'stake') {
        await apiRequest('/api/dex/liquid-staking', { method: 'POST', body: { stakeId, amount: value } });
        setMessage({ ok: true, text: 'Staked; stTGR minted at the current rate.' });
      } else {
        await apiRequest('/api/dex/liquid-staking', { method: 'DELETE', body: { stakeId, shares: value } });
        setMessage({ ok: true, text: 'Unstaked; the underlying token was returned at the current rate.' });
      }
      setAmounts((current) => ({ ...current, [stakeId]: '' }));
      staking.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The staking action was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="Liquid staking (stTGR)"
      subtitle="Stake TGR and receive stTGR, a tradable claim that rises in value as rewards are distributed."
      actions={
        <button
          onClick={staking.reload}
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

      <Panel title="Staking pools" className="mb-4">
        {staking.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
        {staking.error && <p className="text-sm text-red-600 dark:text-red-400">{staking.error}</p>}
        {!staking.loading && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No staking pool has been created yet. An administrator creates one from the DEX admin console.
          </p>
        )}
        {rows.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Pool</Th>
                <Th right>Rate (TGR per stTGR)</Th>
                <Th right>Total staked</Th>
                <Th right>Amount</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pool) => (
                <tr key={pool.stakeId}>
                  <Td>
                    {pool.name}
                    <span className="ml-2 text-xs text-gray-400">{shortenId(pool.stakeId)}</span>
                  </Td>
                  <Td right>{formatNumber(pool.exchangeRate, 6)}</Td>
                  <Td right>
                    {formatAmount(pool.totalStaked)} {pool.stakeToken}
                  </Td>
                  <Td right>
                    <input
                      className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="number"
                      min="0"
                      value={amounts[pool.stakeId] ?? ''}
                      onChange={(event) => setAmounts((current) => ({ ...current, [pool.stakeId]: event.target.value }))}
                    />
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => act(pool.stakeId, 'stake')}
                        disabled={busy !== null || pool.status !== 'active'}
                        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                      >
                        {busy === `${pool.stakeId}:stake` && <Loader2 className="h-3 w-3 animate-spin" />} Stake
                      </button>
                      <button
                        onClick={() => act(pool.stakeId, 'unstake')}
                        disabled={busy !== null}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Unstake
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Your stTGR positions">
        {!staking.loading && positions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You hold no stTGR yet.</p>
        )}
        {positions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Pool</Th>
                <Th right>stTGR held</Th>
                <Th right>Redeemable</Th>
                <Th right>Rate</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.stakeId}>
                  <Td>{position.name}</Td>
                  <Td right>{formatAmount(position.shares)}</Td>
                  <Td right>
                    {formatAmount(position.value)} {position.stakeToken}
                  </Td>
                  <Td right>{formatNumber(position.exchangeRate, 6)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
