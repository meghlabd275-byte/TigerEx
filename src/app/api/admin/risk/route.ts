import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { NO_STORE } from '@/lib/api/route-guards';
import { insuranceFundStatus, positionRisk } from '@/lib/risk/engine';

/**
 * Risk dashboard.
 *
 * Aggregates the live derivative book: open positions with their margin ratio
 * and liquidation flag, the pending liquidation queue, the insurance fund per
 * contract and the latest funding rate per symbol. Every figure is computed
 * from rows the exchange wrote; nothing is estimated.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();

  const positionRows = db
    .prepare(
      `SELECT position_id, user_id, symbol, side, quantity, entry_price, mark_price,
              leverage, margin, margin_mode, position_mode, liquidation_price, unrealized_pnl
         FROM futures_positions
        WHERE status = 'open'
        ORDER BY ABS(unrealized_pnl) DESC
        LIMIT 500`,
    )
    .all() as Array<Record<string, unknown>>;

  const maintenanceRates = new Map<string, number>();
  for (const row of db
    .prepare('SELECT symbol, maintenance_margin_rate FROM futures_markets')
    .all() as Array<{ symbol: string; maintenance_margin_rate: number }>) {
    maintenanceRates.set(row.symbol, Number(row.maintenance_margin_rate));
  }

  const positions = positionRows.map((row) => {
    const rate = maintenanceRates.get(String(row.symbol));
    const computed =
      rate === undefined
        ? null
        : positionRisk({
            side: row.side === 'short' ? 'short' : 'long',
            quantity: Number(row.quantity),
            entryPrice: Number(row.entry_price),
            markPrice: Number(row.mark_price),
            leverage: Number(row.leverage),
            margin: Number(row.margin),
            maintenanceMarginRate: rate,
          });

    return {
      positionId: row.position_id,
      userId: row.user_id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      entryPrice: row.entry_price,
      markPrice: row.mark_price,
      leverage: row.leverage,
      margin: row.margin,
      marginMode: row.margin_mode,
      positionMode: row.position_mode,
      liquidationPrice: row.liquidation_price,
      unrealizedPnl: row.unrealized_pnl,
      marginRatio: computed && !('error' in computed) ? computed.marginRatio : null,
      liquidatable: computed && !('error' in computed) ? computed.liquidatable : null,
    };
  });

  const liquidationQueue = db
    .prepare(
      `SELECT entry_id, user_id, symbol, position_type, quantity, entry_price, mark_price,
              margin_ratio, status, created_at
         FROM liquidation_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 500`,
    )
    .all() as Array<Record<string, unknown>>;

  const insuranceRows = db
    .prepare('SELECT contract, balance, target_balance, fee_share, adl_enabled, adl_threshold FROM insurance_funds ORDER BY contract')
    .all() as Array<Record<string, unknown>>;

  const insurance = insuranceRows.map((row) => {
    const status = insuranceFundStatus(
      Number(row.balance),
      Number(row.target_balance),
      Number(row.adl_threshold),
    );
    return {
      contract: row.contract,
      balance: row.balance,
      targetBalance: row.target_balance,
      feeShare: row.fee_share,
      adlEnabled: row.adl_enabled === 1,
      adlThreshold: row.adl_threshold,
      healthy: status.healthy,
      ratio: Number.isFinite(status.ratio) ? status.ratio : null,
      adlArmed: status.adlArmed,
    };
  });

  const funding = db
    .prepare(
      `SELECT f.symbol, f.funding_rate, f.mark_price, f.index_price, f.premium, f.funding_time_ns
         FROM funding_rates f
         JOIN (SELECT symbol, MAX(funding_time_ns) AS latest FROM funding_rates GROUP BY symbol) m
           ON m.symbol = f.symbol AND m.latest = f.funding_time_ns
        ORDER BY f.symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  const marginLoans = db
    .prepare(
      `SELECT loan_id, user_id, symbol, asset, principal, interest_accrued, collateral_asset,
              collateral_amount, mode, status
         FROM margin_loans WHERE status = 'open'
        ORDER BY interest_accrued DESC LIMIT 500`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      data: {
        positions,
        liquidationQueue,
        insurance,
        funding: funding.map((row) => ({
          symbol: row.symbol,
          fundingRate: row.funding_rate,
          markPrice: row.mark_price,
          indexPrice: row.index_price,
          premium: row.premium,
          fundingTimeNs: row.funding_time_ns,
        })),
        marginLoans,
      },
    },
    { headers: NO_STORE },
  );
}
