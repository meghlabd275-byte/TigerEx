import { NextRequest, NextResponse } from 'next/server';
import { listCampaigns } from '@/lib/earn/launchpool';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Live launchpool campaigns.
 *
 * Read from the exchange's own `launchpad_projects` rows the operator created,
 * with participation counts from the real subscription table. An exchange with
 * no campaigns returns an empty list.
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status')?.trim().toLowerCase();
  const campaigns = listCampaigns(status || undefined);
  return NextResponse.json({ success: true, data: campaigns, campaigns }, { headers: NO_STORE });
}
