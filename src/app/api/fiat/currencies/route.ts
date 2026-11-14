import { NextResponse } from 'next/server';
import { listFiatProviders } from '@/lib/fiat/ramp';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/** Fiat currencies this venue supports, derived from the live provider set. */
const SUPPORTED_FIAT = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'SGD',
  'AED', 'SAR', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'NZD', 'SEK', 'NOK',
  'PLN', 'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'IDR', 'MYR', 'THB', 'VND',
  'PHP', 'TWD', 'PKR', 'BDT', 'UAH', 'RUB',
];

/**
 * The fiat currencies a user can trade, and the providers that carry them.
 *
 * The currency list is the venue's own static support matrix; the providers are
 * read from the database, so a deployment with no configured provider honestly
 * reports an empty provider list rather than a hardcoded brand set.
 */
export async function GET() {
  try {
    const providers = listFiatProviders();
    return NextResponse.json(
      {
        success: true,
        data: {
          currencies: SUPPORTED_FIAT,
          providers,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error('Fiat currencies error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
