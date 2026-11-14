import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { usdPrice } from '@/lib/db/portfolio';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The caller's balances per wallet.
 *
 * Each row is one wallet the user holds and the funds in it, valued at the
 * exchange's own market price. An asset with no listed price is reported with a
 * null value rather than being valued at an invented rate.
 *
 * `network` filters to one chain, which is what the Web3 view asks for; the
 * same rows are also returned under `tokens` for that view.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const network = (request.nextUrl.searchParams.get('network') ?? '').trim().toUpperCase();

  const clauses = ['w.user_id = ?', "w.status = 'active'"];
  const params: string[] = [auth.user.userId];
  if (network) {
    clauses.push('UPPER(w.network) = ?');
    params.push(network);
  }

  const rows = getDb()
    .prepare(
      `SELECT w.wallet_id, w.wallet_type, w.currency, w.network, w.address,
              b.available, b.locked
         FROM wallets w
         LEFT JOIN balances b ON b.wallet_id = w.wallet_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY w.currency, w.wallet_type`,
    )
    .all(...params) as Array<{
    wallet_id: string;
    wallet_type: string;
    currency: string;
    network: string;
    address: string | null;
    available: number | null;
    locked: number | null;
  }>;

  const balances = rows.map((row) => {
    const available = Number(row.available) || 0;
    const locked = Number(row.locked) || 0;
    const price = usdPrice(row.currency);
    return {
      id: row.wallet_id,
      walletId: row.wallet_id,
      walletType: row.wallet_type,
      currency: row.currency,
      asset: row.currency,
      coin: row.currency,
      network: row.network,
      address: row.address,
      available,
      locked,
      balance: available + locked,
      usdPrice: price,
      usdValue: price === null ? null : (available + locked) * price,
    };
  });

  const totalUsdt = balances.reduce((sum, balance) => sum + (balance.usdValue ?? 0), 0);

  return NextResponse.json(
    { success: true, balances, tokens: balances, data: balances, totalUSDT: totalUsdt },
    { headers: NO_STORE },
  );
}
