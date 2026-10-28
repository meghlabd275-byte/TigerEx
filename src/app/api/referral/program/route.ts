import { NextResponse } from 'next/server';
import { REFERRAL_TIERS } from '@/lib/db/referral';

/**
 * Public referral program parameters.
 *
 * These are the live rules the commission engine applies, exported from the
 * same constants the engine uses so the advertised rate cannot drift from the
 * rate actually paid.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      data: {
        tiers: REFERRAL_TIERS.map((tier) => ({
          name: tier.name,
          requiredVolume: tier.requiredVolume,
          commissionRate: tier.commissionRate,
          minReferrals: tier.minReferrals,
        })),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
