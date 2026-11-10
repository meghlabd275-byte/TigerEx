/**
 * Earn subscriptions: subscribing to a product and redeeming it.
 *
 * A subscription locks the principal in the ledger so the same funds cannot be
 * spent while they earn. Redemption releases the principal plus the reward
 * accrued at the product's APR over the real elapsed time; a locked product
 * cannot be redeemed before it matures.
 *
 * A reward is paid from a funded reward account, not minted. The account for an
 * asset is `earn_rewards`; fund it with `fundEarnRewards`. A product whose asset
 * has no reward account pays zero rather than conjuring tokens into a redeemer's
 * balance. The accrued reward is still recorded on the subscription, so the
 * shortfall is visible and can be paid once the account is refilled.
 *
 * The reward maths is the pure `@/lib/earn/products` engine, so the payout a
 * user receives is the same figure the holdings view projects.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import {
  lockAvailable,
  unlockAvailable,
  consumeLocked,
  creditAvailable,
  recordTransaction,
  LedgerError,
} from '@/lib/db/ledger';
import {
  accrueForProduct,
  lockedRedeemable,
  settleDualInvestment,
  settleSharkFin,
  validateDualTerms,
  validateSharkTerms,
} from '@/lib/earn/products';
import { usdPrice } from '@/lib/db/portfolio';
import { creditFund, fundBalance, debitFund } from '@/lib/dex/pool-service';

export class SubscriptionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Reward account for earn products.
 *
 * A reward is paid from this account rather than minted, so the payout is gated
 * on funds the protocol actually set aside. Fund it with `fundEarnRewards`.
 */
const EARN_REWARD_FUND = 'earn_rewards';

/** The balance of the earn reward account for one asset. */
export function earnRewardFundBalance(asset: string): number {
  return fundBalance(EARN_REWARD_FUND, asset);
}

/** Move an amount into the earn reward account, creating it on first use. */
export function fundEarnRewards(asset: string, amount: number): void {
  creditFund(EARN_REWARD_FUND, asset, amount);
}

export interface EarnProductRow {
  product_id: string;
  name: string;
  product_type: string;
  asset: string;
  apy: number;
  duration_days: number | null;
  min_amount: number;
  max_amount: number | null;
  cap: number | null;
  status: string;
  /** Structured terms for dual investment / shark fin, as a JSON string. */
  params: string | null;
}

/** Parse a product's structured-terms JSON, returning an empty object when absent. */
function parseProductTerms(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Active earn products, optionally filtered by product type. */
export function listProducts(productType?: string): EarnProductRow[] {
  const clauses: string[] = ["status = 'active'"];
  const params: string[] = [];
  if (productType) {
    clauses.push('product_type = ?');
    params.push(productType.trim().toLowerCase());
  }
  return getDb()
    .prepare(`SELECT * FROM earn_products WHERE ${clauses.join(' AND ')} ORDER BY product_type, asset`)
    .all(...params) as EarnProductRow[];
}

export interface SubscribeInput {
  userId: string;
  productId: string;
  amount: number;
}

export interface SubscriptionResult {
  subscriptionId: string;
  productId: string;
  asset: string;
  amount: number;
  apy: number;
  maturesAt: string | null;
}

/**
 * Subscribe to a product.
 *
 * The principal is locked (not spent) so it remains the user's funds while it
 * earns and is released on redemption. A product cap is enforced against the
 * total already subscribed.
 */
export function subscribe(input: SubscribeInput): SubscriptionResult {
  const productId = String(input.productId ?? '').trim();
  if (!productId) throw new SubscriptionError('VALIDATION_FAILED', 'productId is required');

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SubscriptionError('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const db = getDb();
  const product = db
    .prepare("SELECT * FROM earn_products WHERE product_id = ? AND status = 'active'")
    .get(productId) as EarnProductRow | undefined;
  if (!product) throw new SubscriptionError('UNKNOWN_PRODUCT', 'No such active earn product', 404);

  const minAmount = Number(product.min_amount) || 0;
  const maxAmount = product.max_amount === null || product.max_amount === undefined ? null : Number(product.max_amount);
  if (amount < minAmount) throw new SubscriptionError('VALIDATION_FAILED', `Minimum subscription is ${minAmount}`);
  if (maxAmount !== null && amount > maxAmount) {
    throw new SubscriptionError('VALIDATION_FAILED', `Maximum subscription is ${maxAmount}`);
  }

  if (product.cap !== null && product.cap !== undefined) {
    const total = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM earn_subscriptions WHERE product_id = ? AND status = 'active'")
      .get(productId) as { total: number } | undefined;
    if ((Number(total?.total) || 0) + amount > Number(product.cap)) {
      throw new SubscriptionError('CAP_EXCEEDED', 'This product has reached its subscription cap', 409);
    }
  }

  const durationDays =
    product.duration_days === null || product.duration_days === undefined ? null : Number(product.duration_days);
  const subscriptionId = generateId();
  const maturesAt = durationDays === null ? null : new Date(Date.now() + durationDays * 86400_000).toISOString();

  // A structured product (dual investment, shark fin) only settles against the
  // terms its admin wrote. Refuse a subscription to one whose terms are missing
  // or malformed rather than accepting principal it could never settle.
  if (product.product_type === 'dual_investment' || product.product_type === 'shark_fin') {
    if (durationDays === null || durationDays <= 0) {
      throw new SubscriptionError('INVALID_PRODUCT', 'This product requires a term in days', 409);
    }
    const terms = parseProductTerms(product.params);
    const valid =
      product.product_type === 'dual_investment' ? validateDualTerms(terms) : validateSharkTerms(terms);
    if ('error' in valid) {
      throw new SubscriptionError('INVALID_PRODUCT', `This product's terms are invalid: ${valid.error}`, 409);
    }
  }

  db.transaction(() => {
    lockAvailable(input.userId, product.asset, amount);
    db.prepare(
      `INSERT INTO earn_subscriptions (subscription_id, user_id, product_id, amount, status, matures_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(subscriptionId, input.userId, productId, amount, maturesAt);
  })();

  return {
    subscriptionId,
    productId,
    asset: product.asset,
    amount,
    apy: Number(product.apy) || 0,
    maturesAt,
  };
}

export interface RedeemResult {
  subscriptionId: string;
  asset: string;
  principal: number;
  reward: number;
  total: number;
}

/**
 * Redeem a subscription.
 *
 * A locked subscription is refused before it matures. The principal is
 * released from the ledger and the reward is credited, both inside one
 * transaction with the status change, so a redemption cannot be repeated.
 */
export function redeem(userId: string, subscriptionId: string): RedeemResult {
  const id = String(subscriptionId ?? '').trim();
  if (!id) throw new SubscriptionError('VALIDATION_FAILED', 'subscriptionId is required');

  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.subscription_id, s.amount, s.status, s.started_at, s.matures_at,
              p.asset, p.apy, p.duration_days, p.product_type, p.params
         FROM earn_subscriptions s JOIN earn_products p ON p.product_id = s.product_id
        WHERE s.subscription_id = ? AND s.user_id = ?`,
    )
    .get(id, userId) as
    | {
        subscription_id: string;
        amount: number;
        status: string;
        started_at: string;
        matures_at: string | null;
        asset: string;
        apy: number;
        duration_days: number | null;
        product_type: string;
        params: string | null;
      }
    | undefined;
  if (!row) throw new SubscriptionError('NOT_FOUND', 'No such subscription for this account', 404);
  if (row.status !== 'active') throw new SubscriptionError('NOT_ACTIVE', 'This subscription is not active', 409);

  const principal = Number(row.amount) || 0;
  const durationDays = row.duration_days === null || row.duration_days === undefined ? null : Number(row.duration_days);
  const startedNs = parseUtcTimestamp(row.started_at) * 1e6;
  const nowNs = Date.now() * 1e6;

  if (durationDays !== null && durationDays > 0 && !lockedRedeemable(startedNs, durationDays, nowNs)) {
    throw new SubscriptionError('LOCKED', 'This subscription is still locked', 409);
  }

  // A dual-investment or shark-fin product settles against the observed spot at
  // maturity, not a simple interest accrual. When the underlying has no listed
  // price the redemption is refused and retried, rather than settled on a guess.
  if (row.product_type === 'dual_investment' || row.product_type === 'shark_fin') {
    return redeemStructured(userId, id, row, durationDays, startedNs, nowNs);
  }

  const reward = accrueForProduct(principal, Number(row.apy) || 0, nowNs - startedNs, row.product_type);

  db.transaction(() => {
    unlockAvailable(userId, row.asset, principal);
    // Pay only what the reward account holds; the rest is recorded, not minted.
    const payable = Math.min(reward, fundBalance(EARN_REWARD_FUND, row.asset));
    if (payable > 0) {
      debitFund(EARN_REWARD_FUND, row.asset, payable);
      creditAvailable(userId, row.asset, payable);
      recordTransaction(userId, 'earn_reward', row.asset, payable, 0, 'completed', `Earn reward ${id}`);
    }
    db.prepare(
      "UPDATE earn_subscriptions SET status = 'redeemed', accrued_reward = ?, redeemed_at = datetime('now') WHERE subscription_id = ?",
    ).run(reward, id);
  })();

  return { subscriptionId: id, asset: row.asset, principal, reward, total: principal + reward };
}

interface StructuredRow {
  subscription_id: string;
  amount: number;
  asset: string;
  apy: number;
  product_type: string;
  params: string | null;
}

/**
 * Settle a dual-investment or shark-fin subscription at maturity.
 *
 * The payoff comes from the pure `settleDualInvestment` / `settleSharkFin`
 * functions, which read the same terms the admin wrote. The settlement price is
 * the venue's own listed spot for the underlying, so the figure is observed
 * rather than invented; when the underlying has no price the redemption is
 * refused and can be retried, never settled on a guess.
 *
 * The locked principal is returned to the user (quote-settled) or consumed to
 * buy the base asset (base-settled), and only the venue's contribution — the
 * yield, or the converted principal — is drawn from the reward account for the
 * payout asset. A shortfall fails closed and leaves the subscription active.
 */
function redeemStructured(
  userId: string,
  id: string,
  row: StructuredRow,
  durationDays: number | null,
  startedNs: number,
  nowNs: number,
): RedeemResult {
  if (durationDays === null || durationDays <= 0) {
    throw new SubscriptionError('INVALID_PRODUCT', 'This product has no term to settle against', 409);
  }
  if (!lockedRedeemable(startedNs, durationDays, nowNs)) {
    throw new SubscriptionError('LOCKED', 'This subscription is still locked', 409);
  }

  const terms = parseProductTerms(row.params);
  const principal = Number(row.amount) || 0;

  let payoutAsset: string;
  let rewardAsset: string;
  let rewardAmount: number;
  let unlockPrincipal: boolean;
  let yieldAmount: number;

  if (row.product_type === 'dual_investment') {
    const valid = validateDualTerms(terms);
    if ('error' in valid) {
      throw new SubscriptionError('INVALID_PRODUCT', `This product's terms are invalid: ${valid.error}`, 409);
    }
    const settlementPrice = usdPrice(valid.underlying);
    if (settlementPrice === null || settlementPrice <= 0) {
      throw new SubscriptionError('NO_SETTLEMENT_PRICE', `No settlement price for ${valid.underlying}`, 503);
    }
    const result = settleDualInvestment({
      amount: principal,
      apy: Number(row.apy) || 0,
      strike: valid.strike,
      settlementPrice,
      direction: valid.direction,
      termDays: durationDays,
    });
    if ('error' in result) throw new SubscriptionError('INVALID_PRODUCT', result.error, 409);

    yieldAmount = result.reward;
    if (result.settlementAsset === 'base') {
      // The quote principal is consumed to buy the base at the strike; the base
      // payout is supplied by the venue's reward account for that asset.
      payoutAsset = valid.underlying;
      rewardAsset = valid.underlying;
      rewardAmount = result.payout;
      unlockPrincipal = false;
    } else {
      payoutAsset = row.asset;
      rewardAsset = row.asset;
      rewardAmount = result.reward;
      unlockPrincipal = true;
    }
  } else {
    const valid = validateSharkTerms(terms);
    if ('error' in valid) {
      throw new SubscriptionError('INVALID_PRODUCT', `This product's terms are invalid: ${valid.error}`, 409);
    }
    const settlementPrice = usdPrice(valid.underlying);
    if (settlementPrice === null || settlementPrice <= 0) {
      throw new SubscriptionError('NO_SETTLEMENT_PRICE', `No settlement price for ${valid.underlying}`, 503);
    }
    const result = settleSharkFin({
      amount: principal,
      minYield: valid.minYield,
      maxYield: valid.maxYield,
      lowerBound: valid.lowerBound,
      upperBound: valid.upperBound,
      settlementPrice,
    });
    if ('error' in result) throw new SubscriptionError('INVALID_PRODUCT', result.error, 409);

    yieldAmount = result.payout - principal;
    // Principal is protected, so it is always returned and only the yield is
    // drawn from the reward account.
    payoutAsset = row.asset;
    rewardAsset = row.asset;
    rewardAmount = yieldAmount;
    unlockPrincipal = true;
  }

  const db = getDb();
  let payable = 0;
  db.transaction(() => {
    if (unlockPrincipal) unlockAvailable(userId, row.asset, principal);
    else consumeLocked(userId, row.asset, principal);

    payable = Math.min(Math.max(rewardAmount, 0), fundBalance(EARN_REWARD_FUND, rewardAsset));
    if (payable > 0) {
      debitFund(EARN_REWARD_FUND, rewardAsset, payable);
      creditAvailable(userId, payoutAsset, payable);
    }
    recordTransaction(
      userId,
      row.product_type === 'dual_investment' ? 'dual_investment_settle' : 'shark_fin_settle',
      payoutAsset,
      (unlockPrincipal ? principal : 0) + payable,
      0,
      'completed',
      `settle ${row.product_type} ${id}`,
    );
    db.prepare(
      "UPDATE earn_subscriptions SET status = 'redeemed', accrued_reward = ?, redeemed_at = datetime('now') WHERE subscription_id = ?",
    ).run(yieldAmount, id);
  })();

  return {
    subscriptionId: id,
    asset: payoutAsset,
    principal,
    reward: yieldAmount,
    total: (unlockPrincipal ? principal : 0) + payable,
  };
}

export { LedgerError };
