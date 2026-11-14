/**
 * Fiat on/off-ramp settlement.
 *
 * A provider (a PSP the operator has contracted with) quotes a fiat buy or
 * sell, the user places the order, and the provider settles it asynchronously
 * and calls back. This module owns the whole lifecycle:
 *
 *   quote -> place -> (provider settles) -> callback -> credit/debit
 *
 * The invariant is the same one the wallet and DEX layers keep: value is never
 * created. A buy credits crypto only when the provider has actually taken the
 * fiat, and a sell releases crypto only when the provider confirms the fiat
 * payout. The provider's fee is withheld from the user's side, never booked on
 * its own.
 *
 * Every state transition is guarded so a replayed provider callback cannot
 * credit twice: the order moves `pending` -> `settled` exactly once, inside one
 * SQLite transaction with the balance move.
 *
 * There is no in-memory provider and no fabricated rate: the quote reads this
 * venue's own `market_data`, and an unconfigured provider set means no ramp.
 */

import { getDb, generateId } from '@/lib/db';
import {
  creditAvailable,
  lockAvailable,
  unlockAvailable,
  consumeLocked,
  availableBalance,
} from '@/lib/db/ledger';
import { recordDeposit, recordWithdrawal } from '@/lib/db/accounting';
import { conversionRate } from '@/lib/db/convert';

export class FiatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type FiatDirection = 'buy' | 'sell';

export interface FiatProviderView {
  id: string;
  name: string;
  logo: string | null;
  paymentMethods: string[];
  minLimit: number;
  maxLimit: number;
  feePercent: number;
}

export interface FiatQuote {
  direction: FiatDirection;
  fiatCurrency: string;
  cryptoCurrency: string;
  fiatAmount: number;
  cryptoAmount: number;
  rate: number;
  feePercent: number;
  feeAmount: number;
  /** Fiat amount the user actually pays (buy) or receives (sell), after fee. */
  netFiatAmount: number;
  providerId: string | null;
}

export interface FiatOrderView {
  orderId: string;
  providerId: string | null;
  direction: FiatDirection;
  fiatCurrency: string;
  cryptoCurrency: string;
  fiatAmount: number;
  cryptoAmount: number;
  rate: number;
  fee: number;
  status: string;
  createdAt: string | null;
}

/** Supported fiat currencies a provider may quote. Operator-configured per provider. */
const SUPPORTED_FIAT = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'SGD',
  'AED', 'SAR', 'TRY', 'BRL', 'MXN', 'INR', 'KRW', 'NZD', 'SEK', 'NOK',
  'PLN', 'ZAR', 'NGN', 'GHS', 'KES', 'EGP', 'IDR', 'MYR', 'THB', 'VND',
  'PHP', 'TWD', 'PKR', 'BDT', 'UAH', 'RUB',
]);

export function isSupportedFiat(currency: string): boolean {
  return SUPPORTED_FIAT.has(currency.toUpperCase());
}

/** List the active providers the operator has configured. */
export function listFiatProviders(): FiatProviderView[] {
  const rows = getDb()
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

  return rows.map((p) => ({
    id: p.provider_id,
    name: p.name,
    logo: p.logo,
    paymentMethods: parseStringArray(p.payment_methods),
    minLimit: Number(p.min_limit),
    maxLimit: Number(p.max_limit),
    feePercent: Number(p.fee_percent),
  }));
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Price a fiat buy or sell.
 *
 * The crypto leg is priced from this venue's own `market_data` (the same source
 * the spot engine uses). When no price exists the quote fails closed rather than
 * inventing a rate. The provider's percentage fee is withheld from the fiat leg:
 * on a buy the user pays `fiatAmount` and receives crypto worth
 * `fiatAmount - fee`; on a sell the user gives crypto worth `fiatAmount` and
 * receives `fiatAmount - fee`.
 */
export function quoteFiat(
  direction: FiatDirection,
  fiatCurrency: string,
  cryptoCurrency: string,
  fiatAmount: number,
  providerId?: string | null,
): FiatQuote {
  const fiat = fiatCurrency.toUpperCase();
  const crypto = cryptoCurrency.toUpperCase();

  if (!isSupportedFiat(fiat)) {
    throw new FiatError('UNSUPPORTED_FIAT', `${fiat} is not a supported fiat currency`, 400);
  }
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    throw new FiatError('INVALID_AMOUNT', 'fiatAmount must be a positive number', 400);
  }

  let feePercent = 0;
  if (providerId) {
    const provider = getDb()
      .prepare(
        `SELECT min_limit, max_limit, fee_percent FROM fiat_providers
          WHERE provider_id = ? AND status = 'active'`,
      )
      .get(providerId) as { min_limit: number; max_limit: number; fee_percent: number } | undefined;
    if (!provider) {
      throw new FiatError('PROVIDER_UNAVAILABLE', 'That fiat provider is not available', 404);
    }
    if (fiatAmount < provider.min_limit || fiatAmount > provider.max_limit) {
      throw new FiatError(
        'LIMIT_EXCEEDED',
        `Amount is outside the provider's ${provider.min_limit}-${provider.max_limit} range`,
        400,
      );
    }
    feePercent = Number(provider.fee_percent);
  }

  const rate = conversionRate(crypto, fiat);
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    throw new FiatError(
      'RATE_UNAVAILABLE',
      `No live ${crypto}/${fiat} rate is available; the order cannot be priced`,
      409,
    );
  }

  const feeAmount = fiatAmount * (feePercent / 100);
  const netFiatAmount = fiatAmount - feeAmount;
  const cryptoAmount = netFiatAmount / rate;

  return {
    direction,
    fiatCurrency: fiat,
    cryptoCurrency: crypto,
    fiatAmount,
    cryptoAmount,
    rate,
    feePercent,
    feeAmount,
    netFiatAmount,
    providerId: providerId ?? null,
  };
}

/**
 * Place a fiat order.
 *
 * A `sell` locks the user's crypto immediately, so the same balance cannot back
 * two pending sells; the lock is consumed on settlement and released on
 * cancellation. A `buy` needs no lock — the provider has not taken the fiat yet
 * — so the crypto is credited only when the callback confirms settlement.
 */
export function placeFiatOrder(
  userId: string,
  direction: FiatDirection,
  fiatCurrency: string,
  cryptoCurrency: string,
  fiatAmount: number,
  providerId?: string | null,
): FiatOrderView {
  const quote = quoteFiat(direction, fiatCurrency, cryptoCurrency, fiatAmount, providerId);
  const db = getDb();
  const orderId = generateId();

  if (direction === 'sell') {
    if (availableBalance(userId, quote.cryptoCurrency) + 1e-12 < quote.cryptoAmount) {
      throw new FiatError('INSUFFICIENT_BALANCE', `Not enough ${quote.cryptoCurrency} to sell`, 400);
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO fiat_orders
         (order_id, user_id, provider_id, direction, fiat_currency, crypto_currency,
          fiat_amount, crypto_amount, rate, fee, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      orderId,
      userId,
      quote.providerId,
      direction,
      quote.fiatCurrency,
      quote.cryptoCurrency,
      quote.fiatAmount,
      quote.cryptoAmount,
      quote.rate,
      quote.feeAmount,
    );

    if (direction === 'sell') {
      lockAvailable(userId, quote.cryptoCurrency, quote.cryptoAmount);
    }
  });
  tx();

  return readFiatOrder(orderId)!;
}

export function readFiatOrder(orderId: string): FiatOrderView | null {
  const row = getDb()
    .prepare(
      `SELECT order_id, provider_id, direction, fiat_currency, crypto_currency,
              fiat_amount, crypto_amount, rate, fee, status, created_at
         FROM fiat_orders WHERE order_id = ?`,
    )
    .get(orderId) as Record<string, unknown> | undefined;
  return row ? mapOrder(row) : null;
}

export function listFiatOrders(userId: string, limit = 20, offset = 0): FiatOrderView[] {
  const rows = getDb()
    .prepare(
      `SELECT order_id, provider_id, direction, fiat_currency, crypto_currency,
              fiat_amount, crypto_amount, rate, fee, status, created_at
         FROM fiat_orders WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as Array<Record<string, unknown>>;
  return rows.map(mapOrder);
}

function mapOrder(row: Record<string, unknown>): FiatOrderView {
  return {
    orderId: String(row.order_id),
    providerId: row.provider_id ? String(row.provider_id) : null,
    direction: String(row.direction) as FiatDirection,
    fiatCurrency: String(row.fiat_currency),
    cryptoCurrency: String(row.crypto_currency),
    fiatAmount: Number(row.fiat_amount),
    cryptoAmount: Number(row.crypto_amount ?? 0),
    rate: Number(row.rate ?? 0),
    fee: Number(row.fee ?? 0),
    status: String(row.status),
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

/**
 * Settle a fiat order from a provider callback.
 *
 * Guarded by a status transition, so a replayed callback (providers retry) is a
 * no-op rather than a second credit. A settled buy credits the user the crypto
 * the provider's fiat bought, booked as a deposit from outside the venue; a
 * settled sell consumes the locked crypto and books a withdrawal. A rejected
 * order releases the seller's lock.
 *
 * @param outcome `settled` when the provider took/paid the fiat, `rejected` otherwise.
 */
export function settleFiatOrder(orderId: string, outcome: 'settled' | 'rejected'): FiatOrderView {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT user_id, direction, crypto_currency, crypto_amount, status
           FROM fiat_orders WHERE order_id = ?`,
      )
      .get(orderId) as
      | { user_id: string; direction: string; crypto_currency: string; crypto_amount: number; status: string }
      | undefined;

    if (!row) throw new FiatError('ORDER_NOT_FOUND', 'No such fiat order', 404);
    if (row.status !== 'pending') {
      throw new FiatError('ALREADY_FINAL', `This order is already ${row.status}`, 409);
    }

    const userId = row.user_id;
    const crypto = row.crypto_currency;
    const cryptoAmount = Number(row.crypto_amount);

    if (outcome === 'rejected') {
      if (row.direction === 'sell') {
        unlockAvailable(userId, crypto, cryptoAmount);
      }
      db.prepare("UPDATE fiat_orders SET status = 'rejected', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
      return;
    }

    if (row.direction === 'buy') {
      creditAvailable(userId, crypto, cryptoAmount);
      recordDeposit(userId, crypto, cryptoAmount, `fiat buy ${orderId}`);
    } else {
      consumeLocked(userId, crypto, cryptoAmount);
      recordWithdrawal(userId, crypto, cryptoAmount, `fiat sell ${orderId}`);
    }
    db.prepare("UPDATE fiat_orders SET status = 'settled', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
  });
  tx();

  return readFiatOrder(orderId)!;
}

/** Cancel a pending order and release the seller's lock. */
export function cancelFiatOrder(orderId: string, userId: string): FiatOrderView {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare('SELECT user_id, direction, crypto_currency, crypto_amount, status FROM fiat_orders WHERE order_id = ?')
      .get(orderId) as
      | { user_id: string; direction: string; crypto_currency: string; crypto_amount: number; status: string }
      | undefined;
    if (!row || row.user_id !== userId) {
      throw new FiatError('ORDER_NOT_FOUND', 'No such fiat order', 404);
    }
    if (row.status !== 'pending') {
      throw new FiatError('ALREADY_FINAL', `This order is already ${row.status}`, 409);
    }
    if (row.direction === 'sell') {
      unlockAvailable(userId, row.crypto_currency, Number(row.crypto_amount));
    }
    db.prepare("UPDATE fiat_orders SET status = 'cancelled', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
  });
  tx();
  return readFiatOrder(orderId)!;
}
