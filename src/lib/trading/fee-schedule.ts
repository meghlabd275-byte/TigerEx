/**
 * The published fee schedule.
 *
 * Trading fees come from `fee_schedule`, the same table the fee engine reads,
 * and network fees come from the operator's withdrawal policies. A chain with
 * no configured policy is omitted rather than given an invented fee, so a
 * client can never quote a withdrawal fee the exchange will not honour.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';
import { withdrawalPolicies } from '@/lib/wallet/withdrawals';

export interface FeeConfig {
  id: string;
  type: 'trade' | 'withdraw' | 'deposit';
  asset: string;
  network?: string;
  fee_type: 'fixed' | 'percentage';
  /** A fraction of notional for a percentage fee, an asset amount for a fixed one. */
  fee_amount: number;
  min_fee?: number;
  max_fee?: number;
  updated_at?: string;
}

/** Trading fees per VIP level, as fractions of notional. */
function tradeFees(): FeeConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM fee_schedule ORDER BY level')
    .all() as Array<{
    level: number;
    name: string;
    spot_maker_bps: number;
    spot_taker_bps: number;
    futures_maker_bps: number;
    futures_taker_bps: number;
    updated_at: string | null;
  }>;

  const configs: FeeConfig[] = [];
  for (const row of rows) {
    const updated_at = row.updated_at ?? undefined;
    configs.push(
      {
        id: `trade:spot:maker:${row.level}`,
        type: 'trade',
        asset: 'spot',
        fee_type: 'percentage',
        fee_amount: row.spot_maker_bps / 10000,
        updated_at,
      },
      {
        id: `trade:spot:taker:${row.level}`,
        type: 'trade',
        asset: 'spot',
        fee_type: 'percentage',
        fee_amount: row.spot_taker_bps / 10000,
        updated_at,
      },
      {
        id: `trade:futures:maker:${row.level}`,
        type: 'trade',
        asset: 'futures',
        fee_type: 'percentage',
        fee_amount: row.futures_maker_bps / 10000,
        updated_at,
      },
      {
        id: `trade:futures:taker:${row.level}`,
        type: 'trade',
        asset: 'futures',
        fee_type: 'percentage',
        fee_amount: row.futures_taker_bps / 10000,
        updated_at,
      },
    );
  }
  return configs;
}

/** Network withdrawal fees from the configured policies. */
function withdrawalFees(): FeeConfig[] {
  return withdrawalPolicies()
    .filter((policy) => policy.enabled)
    .map((policy) => ({
      id: `withdraw:${policy.asset}:${policy.network}`,
      type: 'withdraw' as const,
      asset: policy.asset,
      network: policy.network,
      fee_type: 'fixed' as const,
      fee_amount: policy.fee,
      min_fee: policy.fee,
      max_fee: policy.fee,
    }));
}

/** The full published schedule. */
export function feeConfigs(): FeeConfig[] {
  return [...tradeFees(), ...withdrawalFees()];
}
