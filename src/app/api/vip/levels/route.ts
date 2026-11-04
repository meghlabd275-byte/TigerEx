import { NextResponse } from 'next/server';
import { vipLevels } from '@/lib/trading/vip';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The published VIP fee ladder.
 *
 * Served from the same `fee_schedule` the fee engine charges from, so the page
 * cannot advertise a rate the engine will not apply. Public, like a fee page.
 */
export async function GET() {
  const levels = vipLevels();
  return NextResponse.json({ success: true, levels, data: levels }, { headers: NO_STORE });
}
