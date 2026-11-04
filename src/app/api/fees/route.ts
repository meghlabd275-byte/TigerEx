import { NextResponse } from 'next/server';
import { feeConfigs } from '@/lib/trading/fee-schedule';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The published fee schedule.
 *
 * Trading fees are read from the same `fee_schedule` the fee engine charges
 * from, and withdrawal fees from the operator's own policies, so the page
 * cannot show a rate the exchange will not apply. Public, like a fee page.
 */
export async function GET() {
  const configs = feeConfigs();
  return NextResponse.json({ success: true, fees: configs, data: configs }, { headers: NO_STORE });
}
