/**
 * Provider-neutral fiat settlement transport.
 *
 * The exchange does not embed any PSP's SDK. Instead it speaks one small,
 * signed HTTP contract to whichever provider the operator has contracted with:
 *
 *   POST {TIGEREX_FIAT_PROVIDER_URL}/orders      - hand the order to the provider
 *   POST {TIGEREX_FIAT_PROVIDER_URL}/refunds     - reverse a settled order
 *
 * The provider calls the exchange back at `/api/fiat/callback`, signing the raw
 * body with the shared secret so a forged callback cannot settle an order.
 *
 * When the URL or secret is unset the transport is absent and every dependent
 * flow fails closed: an order is never reported as submitted when no provider
 * could have received it. This mirrors the SMS/email verification-code senders.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface FiatProviderOrder {
  orderId: string;
  userId: string;
  direction: 'buy' | 'sell';
  fiatCurrency: string;
  cryptoCurrency: string;
  fiatAmount: number;
  cryptoAmount: number;
  rate: number;
  fee: number;
}

export interface FiatProviderTransport {
  /** Submit an order to the provider; resolves once the provider has accepted it. */
  submit(order: FiatProviderOrder): Promise<void>;
  /** Ask the provider to reverse a settled order (chargeback / recall). */
  refund(orderId: string, reason: string): Promise<void>;
}

let cached: FiatProviderTransport | null | undefined;

function config(): { url: string; key: string } | null {
  const url = process.env.TIGEREX_FIAT_PROVIDER_URL;
  const key = process.env.TIGEREX_FIAT_PROVIDER_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

function build(): FiatProviderTransport | null {
  const cfg = config();
  if (!cfg) return null;

  const call = async (path: string, body: unknown): Promise<void> => {
    const response = await fetch(`${cfg.url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`fiat provider responded with HTTP ${response.status}`);
    }
  };

  return {
    submit: (order) => call('/orders', order),
    refund: (orderId, reason) => call('/refunds', { orderId, reason }),
  };
}

export function getFiatProvider(): FiatProviderTransport | null {
  if (cached === undefined) cached = build();
  return cached;
}

/** Reset the cached transport; used by tests that change the environment. */
export function resetFiatProvider(): void {
  cached = undefined;
}

/** The header carrying the provider's HMAC over the raw request body. */
export const FIAT_SIGNATURE_HEADER = 'x-tigerex-fiat-signature';

/**
 * Verify a provider callback signature.
 *
 * The signature is HMAC-SHA256 over the exact raw body, hex encoded, compared in
 * constant time. An unset secret means no callback can be trusted, so the check
 * fails closed rather than accepting an unsigned body.
 */
export function verifyFiatCallback(rawBody: string, signature: string | null): boolean {
  const secret = process.env.TIGEREX_FIAT_CALLBACK_SECRET;
  if (!secret) return false;
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
