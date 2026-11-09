'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, shortenId } from '@/lib/dex/format';

interface VaultsResponse {
  vaults: Array<{
    vaultId: string;
    name: string;
    kind: string;
    poolId: string;
    stakedToken: string;
    rewardToken: string;
    totalAssets: number;
    totalSupply: number;
    sharePrice: number;
    performanceFeeBps: number;
    status: string;
  }>;
  positions: Array<{
    vaultId: string;
    name: string;
    stakedToken: string;
    rewardToken: string;
    shares: number;
    assets: number;
    sharePrice: number;
  }>;
}

export default function DexVaultsPage() {
  const vaults = useApiResource<VaultsResponse>('/api/dex/vaults');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = vaults.data?.vaults ?? [];
  const positions = vaults.data?.positions ?? [];

  const act = async (vaultId: string, action: 'deposit' | 'withdraw') => {
    setBusy(`${vaultId}:${action}`);
    setMessage(null);
    try {
      const value = Number(amounts[vaultId]);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a positive amount.');
      if (action === 'deposit') {
        await apiRequest('/api/dex/vaults', { method: 'POST', body: { vaultId, assets: value } });
        setMessage({ ok: true, text: 'Deposit accepted; shares minted at the current price.' });
      } else {
        await apiRequest('/api/dex/vaults', { method: 'DELETE', body: { vaultId, shares: value } });
        setMessage({ ok: true, text: 'Withdrawal settled; assets returned at the current price.' });
      }
      setAmounts((current) => ({ ...current, [vaultId]: '' }));
      vaults.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The vault action was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="Auto-compounding vaults"
      subtitle="Deposit the vault's staked token and hold shares. The vault compounds the farm rewards into the share price."
      actions={
        <button
          onClick={vaults.reload}
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

      <Panel title="Vaults" className="mb-4">
        {vaults.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading vaults…</p>}
        {vaults.error && <p className="text-sm text-red-600 dark:text-red-400">{vaults.error}</p>}
        {!vaults.loading && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No vault has been created yet. An administrator creates vaults from the DEX admin console.
          </p>
        )}
        {rows.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Vault</Th>
                <Th>Staked token</Th>
                <Th right>Share price</Th>
                <Th right>Total assets</Th>
                <Th right>Amount</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((vault) => (
                <tr key={vault.vaultId}>
                  <Td>
                    {vault.name}
                    <span className="ml-2 text-xs text-gray-400">{shortenId(vault.vaultId)}</span>
                  </Td>
                  <Td>{vault.stakedToken}</Td>
                  <Td right>{formatNumber(vault.sharePrice, 6)}</Td>
                  <Td right>{formatAmount(vault.totalAssets)}</Td>
                  <Td right>
                    <input
                      className="w-28 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="number"
                      min="0"
                      value={amounts[vault.vaultId] ?? ''}
                      onChange={(event) => setAmounts((current) => ({ ...current, [vault.vaultId]: event.target.value }))}
                    />
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => act(vault.vaultId, 'deposit')}
                        disabled={busy !== null || vault.status !== 'active'}
                        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                      >
                        {busy === `${vault.vaultId}:deposit` && <Loader2 className="h-3 w-3 animate-spin" />} Deposit
                      </button>
                      <button
                        onClick={() => act(vault.vaultId, 'withdraw')}
                        disabled={busy !== null}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Withdraw
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Your vault positions">
        {!vaults.loading && positions.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no vault position yet.</p>
        )}
        {positions.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Vault</Th>
                <Th right>Shares</Th>
                <Th right>Value</Th>
                <Th right>Share price</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.vaultId}>
                  <Td>{position.name}</Td>
                  <Td right>{formatAmount(position.shares)}</Td>
                  <Td right>
                    {formatAmount(position.assets)} {position.stakedToken}
                  </Td>
                  <Td right>{formatNumber(position.sharePrice, 6)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
