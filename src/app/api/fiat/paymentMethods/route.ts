import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Available fiat on/off-ramp providers.
 *
 * Providers are read from the database, which the operator populates when a
 * ramp contract is live. An empty list is returned honestly when no provider
 * has been configured, rather than a hardcoded set of brand names.
 */
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT provider_id, name, logo, payment_methods, min_limit, max_limit, fee_percent
           FROM fiat_providers WHERE status = 'active' ORDER BY name`,
      )
      .all() as Array<{
      provider_id: string;
      name: string;
      logo: string | null;
      payment_methods: string;
      min_limit: number;
      max_limit: number;
      fee_percent: number;
    }>;

    return NextResponse.json(
      {
        success: true,
        data: rows.map((p) => {
          let methods: string[] = [];
          try {
            const parsed = JSON.parse(p.payment_methods);
            if (Array.isArray(parsed)) methods = parsed.map(String);
          } catch {
            methods = [];
          }
          return {
            id: p.provider_id,
            name: p.name,
            logo: p.logo,
            paymentMethods: methods,
            minLimit: p.min_limit,
            maxLimit: p.max_limit,
            feePercent: p.fee_percent,
          };
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Fiat payment methods error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
