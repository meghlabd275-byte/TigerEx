'use client';

import { RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { formatAmount, formatPercent, formatUsd, shortenId } from '@/lib/dex/format';

interface IntelligenceResponse {
  leaderboard: {
    traders: Array<{
      userId: string;
      swaps: number;
      volumeUsd: number;
      feesUsd: number;
      realizedPnlUsd: number;
      lastTradeAt: string | null;
    }>;
    totalVolumeUsd: number;
    fullyPriced: boolean;
  };
  whales: Array<{
    userId: string;
    asset: string;
    side: 'buy' | 'sell';
    amount: number;
    valueUsd: number;
    poolId: string;
    at: string | null;
  }>;
  signals: Array<{
    asset: string;
    direction: 'accumulation' | 'distribution';
    netUsd: number;
    buyers: number;
    sellers: number;
    strength: number;
  }>;
}

/**
 * TigerSwap trading intelligence.
 *
 * The ranking, the whale feed and the smart-money signal are all computed from
 * the venue's own settled swaps and closed positions, so every figure reflects
 * real trading. An asset the venue cannot price is left out rather than valued
 * at zero, and the page says so when that happens.
 */
export default function DexTradersPage() {
  const intel = useApiResource<IntelligenceResponse>('/api/dex/intelligence');
  const traders = intel.data?.leaderboard.traders ?? [];
  const whales = intel.data?.whales ?? [];
  const signals = intel.data?.signals ?? [];

  return (
    <DexShell
      title="Traders & signals"
      subtitle="Top traders by realised profit, large swaps, and per-asset flow — all computed from TigerSwap's own settled trades."
      actions={
        <button
          onClick={() => intel.reload()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {intel.error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{intel.error}</p>}
      {intel.data && !intel.data.leaderboard.fullyPriced && (
        <p className="mb-3 text-sm text-amber-600 dark:text-amber-400">
          Some swaps used an asset with no listed price, so their volume is excluded from the ranking.
        </p>
      )}

      <Panel title="Top traders">
        {intel.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading traders…</p>}
        {!intel.loading && traders.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No settled trades yet.</p>
        )}
        {traders.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Trader</Th>
                <Th right>Swaps</Th>
                <Th right>Volume</Th>
                <Th right>Fees</Th>
                <Th right>Realised PnL</Th>
                <Th right>Last trade</Th>
              </tr>
            </thead>
            <tbody>
              {traders.map((trader) => (
                <tr key={trader.userId}>
                  <Td>{shortenId(trader.userId)}</Td>
                  <Td right>{trader.swaps}</Td>
                  <Td right>{formatUsd(trader.volumeUsd)}</Td>
                  <Td right>{formatUsd(trader.feesUsd)}</Td>
                  <Td right>
                    <span className={trader.realizedPnlUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {formatUsd(trader.realizedPnlUsd)}
                    </span>
                  </Td>
                  <Td right>{trader.lastTradeAt ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Smart-money signals" className="mt-4">
        {!intel.loading && signals.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">Not enough recent flow for a signal.</p>
        )}
        {signals.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th>Direction</Th>
                <Th right>Net flow</Th>
                <Th right>Buyers</Th>
                <Th right>Sellers</Th>
                <Th right>Strength</Th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => (
                <tr key={signal.asset}>
                  <Td>{signal.asset}</Td>
                  <Td>
                    <span
                      className={
                        signal.direction === 'accumulation'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {signal.direction}
                    </span>
                  </Td>
                  <Td right>{formatUsd(signal.netUsd)}</Td>
                  <Td right>{signal.buyers}</Td>
                  <Td right>{signal.sellers}</Td>
                  <Td right>{formatPercent(signal.strength)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Whale activity" className="mt-4">
        {!intel.loading && whales.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No large swaps above the threshold.</p>
        )}
        {whales.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Wallet</Th>
                <Th>Side</Th>
                <Th>Asset</Th>
                <Th right>Amount</Th>
                <Th right>Value</Th>
                <Th right>Pool</Th>
              </tr>
            </thead>
            <tbody>
              {whales.map((whale, index) => (
                <tr key={`${whale.userId}-${index}`}>
                  <Td>{shortenId(whale.userId)}</Td>
                  <Td>
                    <span className={whale.side === 'buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                      {whale.side}
                    </span>
                  </Td>
                  <Td>{whale.asset}</Td>
                  <Td right>{formatAmount(whale.amount)}</Td>
                  <Td right>{formatUsd(whale.valueUsd)}</Td>
                  <Td right>{shortenId(whale.poolId)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
