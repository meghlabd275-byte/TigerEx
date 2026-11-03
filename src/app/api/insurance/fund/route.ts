import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Insurance fund balances.
 *
 * Reads the exchange's own `insurance_funds` table. A contract with no fund row
 * is reported with a zero balance rather than an invented figure, and the
 * balance is never negative.
 */
export async function GET(request: NextRequest) {
  const contract = request.nextUrl.searchParams.get('contract')?.trim().toUpperCase();

  const clauses: string[] = [];
  const params: string[] = [];
  if (contract) {
    clauses.push('contract = ?');
    params.push(contract);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT contract, balance, target_balance, fee_share, adl_enabled, adl_threshold, updated_at FROM insurance_funds${where} ORDER BY contract`)
    .all(...params) as Array<Record<string, unknown>>;

  const total = rows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);

  return NextResponse.json(
    {
      success: true,
      funds: rows.map((row) => ({
        contract: row.contract,
        balance: Number(row.balance) || 0,
        targetBalance: Number(row.target_balance) || 0,
        feeShare: Number(row.fee_share) || 0,
        adlEnabled: row.adl_enabled === 1,
        adlThreshold: Number(row.adl_threshold) || 0,
        updatedAt: row.updated_at,
      })),
      totalBalance: total,
    },
    { headers: NO_STORE },
  );
}
