'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, shortenId } from '@/lib/dex/format';

interface FarmsResponse {
  farms: Array<{
    farm_id: string;
    name: string;
    pool_id: string;
    reward_token: string;
    reward_rate: number;
    apr: number;
    total_staked: number;
    boost_multiplier: number;
    status: string;
  }>;
  positions: Array<{
    farmId: string;
    name: string;
    poolId: string;
    staked: number;
    pendingRewards: number;
    rewardToken: string;
    apr: number;
    boostMultiplier: number;
  }>;
}

export default function DexFarmsPage() {
  const farms = useApiResource<FarmsResponse>('/api/dex/farms');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = farms.data?.farms ?? [];
  const positions = farms.data?.positions ?? [];

  const act = async (farmId: string, action: 'stake' | 'unstake' | 'claim', amount?: number) => {
    setBusy(`${farmId}:${action}`);
    setMessage(null);
    try {
      if (action === 'claim') {
        const body = await apiRequest<{ claimed: number }>('/api/dex/farms', {
          method: 'PUT',
          body: { farmId },
        });
        setMessage({ ok: true, text: `Claimed ${formatAmount(body.claimed)} reward tokens.` });
      } else {
        await apiRequest('/api/dex/farms', { method: 'POST', body: { farmId, amount, action } });
        setMessage({ ok: true, text: action === 'stake' ? 'LP tokens staked.' : 'LP tokens unstaked.' });
      }
      farms.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The farm action was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="Farms"
      subtitle="Stake a pool's LP tokens to earn the farm's reward token."
      actions={
        <button
          onClick={farms.reload}
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

      <Panel title="Available farms" className="mb-4">
        {farms.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading farms…</p>}
        {farms.error && <p className="text-sm text-red-600 dark:text-red-400">{farms.error}</p>}
        {!farms.loading && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No farm has been created yet. An administrator creates farms from the DEX admin console.
          </p>
        )}
        {rows.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Farm</Th>
                <Th>Pool</Th>
                <Th>Reward</Th>
                <Th right>APR</Th>
                <Th right>Total staked</Th>
                <Th right>Stake amount</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((farm) => (
                <tr key={farm.farm_id}>
                  <Td>
                    {farm.name}
                    <span className="ml-2 text-xs text-gray-400">{shortenId(farm.farm_id)}</span>
                  </Td>
                  <Td>{shortenId(farm.pool_id)}</Td>
                  <Td>{farm.reward_token}</Td>
                  <Td right>{formatNumber(farm.apr, 2)}%</Td>
                  <Td right>{formatAmount(farm.total_staked)}</Td>
                  <Td right>
                    <input
                      className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="number"
                      min="0"
                      value={amounts[farm.farm_id] ?? ''}
                      onChange={(event) => setAmounts((current) => ({ ...current, [farm.farm_id]: event.target.value }))}
                    />
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => act(farm.farm_id, 'stake', Number(amounts[farm.farm_id]))}
                        disabled={busy !== null || farm.status !== 'active'}
                        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                      >
                        {busy === `${farm.farm_id}:stake` && <Loader2 className="h-3 w-3 animate-spin" />} Stake
                      </button>
                      <button
                        onClick={() => act(farm.farm_id, 'unstake', Number(amounts[farm.farm_id]))}
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

      <Panel title="Your stakes">
        {!farms.loading && positions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no farm stake yet.</p>
        )}
        {positions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Farm</Th>
                <Th right>Staked</Th>
                <Th right>Pending rewards</Th>
                <Th right>APR</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.farmId}>
                  <Td>{position.name}</Td>
                  <Td right>{formatAmount(position.staked)}</Td>
                  <Td right>
                    {formatAmount(position.pendingRewards)} {position.rewardToken}
                  </Td>
                  <Td right>{formatNumber(position.apr, 2)}%</Td>
                  <Td right>
                    <button
                      onClick={() => act(position.farmId, 'claim')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                    >
                      {busy === `${position.farmId}:claim` && <Loader2 className="h-3 w-3 animate-spin" />} Claim
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
