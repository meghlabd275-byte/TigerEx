/**
 * TigerSwap launchpad, NFT marketplace and cross-chain bridge settlement.
 *
 * A launch project is a token sale: contributors pay the quote asset and receive
 * tokens allocated by the curve or by stake weight. The NFT marketplace settles
 * a sale between two accounts in the ledger. The bridge locks the asset on the
 * source chain and releases it on the destination through the protocol's own
 * relayer. All three move real balances inside one transaction.
 */

import { getDb, generateId } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { debitAvailable, creditAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  recordDexRevenue,
  assertDexOpen,
  assertNotBlacklisted,
  creditFund,
  debitFund,
  fundBalance,
} from '@/lib/dex/pool-service';
import {
  bondingTokensForBudget,
  bondingSellProceeds,
  allocateIdo,
  lbpWeightAt,
  lbpSpotPrice,
  type BondingCurve,
} from '@/lib/dex/launchpad';
import { applySchedule } from '@/lib/dex/fee-engine';

interface LaunchProjectRow {
  project_id: string;
  name: string;
  symbol: string;
  kind: string;
  total_supply: number;
  price: number;
  raise_target: number;
  raised: number;
  curve_k: number | null;
  soft_cap: number | null;
  hard_cap: number | null;
  quote_asset: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
}

function loadProject(projectId: string): LaunchProjectRow {
  const row = getDb().prepare('SELECT * FROM dex_launch_projects WHERE project_id = ?').get(projectId) as
    | LaunchProjectRow
    | undefined;
  if (!row) throw new DexError('UNKNOWN_PROJECT', `project ${projectId} does not exist`, 404);
  return row;
}

/** Whether a project is inside its sale window. */
function assertOpen(project: LaunchProjectRow): void {
  if (project.status !== 'live' && project.status !== 'pending') {
    throw new DexError('PROJECT_NOT_LIVE', `project is ${project.status}`, 409);
  }
  const now = Date.now();
  if (project.start_at && parseUtcTimestamp(project.start_at) > now) {
    throw new DexError('PROJECT_NOT_STARTED', `the sale starts at ${project.start_at}`, 409);
  }
  if (project.end_at && parseUtcTimestamp(project.end_at) < now) {
    throw new DexError('PROJECT_ENDED', `the sale ended at ${project.end_at}`, 409);
  }
}

export interface ContributeResult {
  contributionId: string;
  projectId: string;
  amount: number;
  tokens: number;
}

/**
 * Contribute to a launch project.
 *
 * A bonding-curve project prices the tokens from the curve's current sold
 * supply; an IDO charges the fixed price. In both cases the contribution is
 * recorded and the tokens are allocated immediately, with the tokens minted
 * into the contributor's balance.
 */
export function contribute(userId: string, projectId: string, amount: number, quoteAsset = 'RUSD'): ContributeResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  assertDexOpen('dex', 'dex_launchpad');
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const project = loadProject(projectId);
  assertOpen(project);
  const quote = quoteAsset.toUpperCase();
  if (quote !== String(project.quote_asset ?? 'RUSD').toUpperCase()) {
    throw new DexError('WRONG_QUOTE', `this project raises ${project.quote_asset}`, 400);
  }

  if (!covers(availableBalance(userId, quote), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${quote} balance`, 400);
  }

  const sold = getDb()
    .prepare('SELECT COALESCE(SUM(tokens), 0) AS sold FROM dex_launch_contributions WHERE project_id = ?')
    .get(projectId) as { sold: number };
  const soldTokens = Number(sold.sold) || 0;

  let tokens: number;
  if (project.kind === 'bonding') {
    const curve: BondingCurve = { kind: 'linear', basePrice: project.price, slope: Number(project.curve_k) || 0.000001 };
    tokens = bondingTokensForBudget(curve, soldTokens, amount, 1, project.total_supply);
  } else {
    tokens = amount / project.price;
  }
  if (!Number.isFinite(tokens) || tokens <= 0) {
    throw new DexError('INVALID_ALLOCATION', 'the contribution buys no tokens', 409);
  }
  if (soldTokens + tokens > project.total_supply + 1e-9) {
    throw new DexError('SOLD_OUT', 'the project has no supply left', 409);
  }
  if (project.hard_cap && project.raised + amount > project.hard_cap) {
    throw new DexError('HARD_CAP_REACHED', 'the project has reached its hard cap', 409);
  }

  const contributionId = generateId();
  getDb().transaction(() => {
    debitAvailable(userId, quote, amount);
    recordTransaction(userId, 'dex_launch_contribute', quote, amount, 0, 'completed', `project ${projectId}`);
    creditAvailable(userId, project.symbol, tokens);
    recordTransaction(userId, 'dex_launch_tokens', project.symbol, tokens, 0, 'completed', `project ${projectId}`);

    // The raise is escrowed in the project's own account rather than left in the
    // contributor's wake: the venue holds the quote until the project claims it,
    // so the tokens credited above are paid for and the project can only draw
    // what contributors actually paid.
    creditFund(launchEscrowAccount(projectId), quote, amount);

    getDb()
      .prepare('INSERT INTO dex_launch_contributions (contribution_id, project_id, user_id, amount, tokens) VALUES (?, ?, ?, ?, ?)')
      .run(contributionId, projectId, userId, amount, tokens);
    getDb()
      .prepare("UPDATE dex_launch_projects SET raised = raised + ?, status = CASE WHEN status = 'pending' THEN 'live' ELSE status END WHERE project_id = ?")
      .run(amount, projectId);
  })();

  return { contributionId, projectId, amount, tokens };
}

/** The escrow account that holds a project's raise until the project claims it. */
export function launchEscrowAccount(projectId: string): string {
  return `dex_launch_escrow:${projectId}`;
}

export interface ClaimRaiseResult {
  projectId: string;
  quoteAsset: string;
  amount: number;
}

/**
 * Pay a completed project the raise its contributors escrowed.
 *
 * The project may claim only what the escrow actually holds, so the payout is a
 * transfer of contributed funds, never a mint. The project is marked `claimed`
 * once, and the single status change is the guard against a second claim.
 */
export function claimRaise(projectId: string, projectUserId: string): ClaimRaiseResult {
  const project = loadProject(projectId);
  if (project.status === 'claimed') throw new DexError('ALREADY_CLAIMED', 'the raise has been claimed', 409);
  if (project.status === 'live' || project.status === 'pending') {
    throw new DexError('PROJECT_OPEN', 'the raise can be claimed only after the sale closes', 409);
  }
  const quote = String(project.quote_asset ?? 'RUSD').toUpperCase();
  const held = fundBalance(launchEscrowAccount(projectId), quote);
  if (!(held > 0)) throw new DexError('NOTHING_RAISED', 'the project raised nothing to claim', 409);

  return getDb().transaction(() => {
    debitFund(launchEscrowAccount(projectId), quote, held);
    creditAvailable(projectUserId, quote, held);
    recordTransaction(projectUserId, 'dex_launch_claim', quote, held, 0, 'completed', `project ${projectId}`);
    getDb()
      .prepare("UPDATE dex_launch_projects SET status = 'claimed' WHERE project_id = ?")
      .run(projectId);
    return { projectId, quoteAsset: quote, amount: held };
  })() as ClaimRaiseResult;
}

/** A project's contributions and progress. */
export function projectDetail(projectId: string): Record<string, unknown> {
  const project = loadProject(projectId);
  const stats = getDb()
    .prepare('SELECT COUNT(*) AS contributors, COALESCE(SUM(tokens), 0) AS sold FROM dex_launch_contributions WHERE project_id = ?')
    .get(projectId) as { contributors: number; sold: number };
  return {
    projectId: project.project_id,
    name: project.name,
    symbol: project.symbol,
    kind: project.kind,
    totalSupply: project.total_supply,
    price: project.price,
    raiseTarget: project.raise_target,
    raised: project.raised,
    sold: stats.sold,
    contributors: stats.contributors,
    startAt: project.start_at,
    endAt: project.end_at,
    status: project.status,
    curveK: project.curve_k,
    softCap: project.soft_cap,
    hardCap: project.hard_cap,
  };
}

/** Every launch project, newest first. */
export function listProjects(): Array<Record<string, unknown>> {
  const rows = getDb().prepare('SELECT * FROM dex_launch_projects ORDER BY created_at DESC').all() as LaunchProjectRow[];
  return rows.map((row) => projectDetail(row.project_id));
}

// ============================================================================
// NFT marketplace
// ============================================================================

export interface ListNftRequest {
  sellerId: string;
  collection: string;
  tokenId: string;
  price: number;
  currency?: string;
}

/** List an NFT for sale. The seller must hold the item, tracked by the listing row. */
export function listNft(request: ListNftRequest): string {
  assertDexOpen('dex');
  assertNotBlacklisted([{ kind: 'wallet', value: request.sellerId }]);
  if (!request.collection || !request.tokenId) {
    throw new DexError('INVALID_NFT', 'collection and tokenId are required', 400);
  }
  if (!Number.isFinite(request.price) || request.price <= 0) {
    throw new DexError('INVALID_PRICE', 'price must be positive', 400);
  }
  const existing = getDb()
    .prepare("SELECT listing_id FROM dex_nft_listings WHERE collection = ? AND token_id = ? AND status = 'listed'")
    .get(request.collection, request.tokenId);
  if (existing) throw new DexError('ALREADY_LISTED', 'this item is already listed', 409);

  const listingId = generateId();
  getDb()
    .prepare('INSERT INTO dex_nft_listings (listing_id, collection, token_id, seller_id, price, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(listingId, request.collection, request.tokenId, request.sellerId, request.price, (request.currency ?? 'RUSD').toUpperCase(), 'listed');
  return listingId;
}

export interface BuyNftResult {
  listingId: string;
  price: number;
  fee: number;
  sellerProceeds: number;
}

/** Buy a listed NFT; the platform fee is split by the DEX revenue schedule. */
export function buyNft(buyerId: string, listingId: string): BuyNftResult {
  assertDexOpen('dex');
  assertNotBlacklisted([{ kind: 'wallet', value: buyerId }]);
  const listing = getDb()
    .prepare("SELECT * FROM dex_nft_listings WHERE listing_id = ? AND status = 'listed'")
    .get(listingId) as
    | { listing_id: string; seller_id: string; price: number; currency: string; collection: string; token_id: string }
    | undefined;
  if (!listing) throw new DexError('NO_LISTING', 'no active listing with that id', 404);
  if (listing.seller_id === buyerId) throw new DexError('SELF_TRADE', 'the seller cannot buy their own listing', 400);
  if (!covers(availableBalance(buyerId, listing.currency), listing.price)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${listing.currency} balance`, 400);
  }

  const feeBps = dexSetting('dex_nft_fee_bps', 250);
  const fee = (listing.price * feeBps) / 10_000;
  const sellerProceeds = listing.price - fee;

  getDb().transaction(() => {
    debitAvailable(buyerId, listing.currency, listing.price);
    creditAvailable(listing.seller_id, listing.currency, sellerProceeds);
    recordTransaction(buyerId, 'dex_nft_buy', listing.currency, listing.price, fee, 'completed', `nft ${listingId}`);
    recordTransaction(listing.seller_id, 'dex_nft_sell', listing.currency, sellerProceeds, 0, 'completed', `nft ${listingId}`);
    const parts = applySchedule(fee, { lpBps: 0, vetgrBps: 4000, treasuryBps: 6000, insuranceBps: 0, burnBps: 0 });
    recordDexRevenue('dex_nft_fee', listing.currency, fee, parts, listingId);
    getDb()
      .prepare("UPDATE dex_nft_listings SET status = 'sold', buyer_id = ?, sold_at = datetime('now') WHERE listing_id = ?")
      .run(buyerId, listingId);
  })();

  return { listingId, price: listing.price, fee, sellerProceeds };
}

/** Active and recent NFT listings. */
export function listNftListings(): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM dex_nft_listings ORDER BY created_at DESC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
}

// ============================================================================
// Cross-chain bridge
// ============================================================================

export interface BridgeRequest {
  userId: string;
  fromChain: string;
  toChain: string;
  asset: string;
  amount: number;
}

/**
 * Initiate a bridge transfer.
 *
 * The asset is debited from the sender and the transfer is recorded as pending;
 * the relayer releases it on the destination chain. The bridge fee is taken from
 * the amount and routed to the treasury.
 */
export function initiateBridge(request: BridgeRequest): { transferId: string; fee: number; receives: number } {
  if (!request.fromChain || !request.toChain) {
    throw new DexError('INVALID_CHAIN', 'fromChain and toChain are required', 400);
  }
  if (request.fromChain === request.toChain) {
    throw new DexError('INVALID_CHAIN', 'source and destination chains must differ', 400);
  }
  if (!Number.isFinite(request.amount) || request.amount <= 0) {
    throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  }
  assertDexOpen('dex', 'dex_bridge');
  const asset = request.asset.toUpperCase();
  assertNotBlacklisted([
    { kind: 'wallet', value: request.userId },
    { kind: 'token', value: asset },
  ]);
  const feeBps = dexSetting('dex_bridge_fee_bps', 10);
  const fee = (request.amount * feeBps) / 10_000;
  const receives = request.amount - fee;

  if (!covers(availableBalance(request.userId, asset), request.amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`, 400);
  }

  const transferId = generateId();
  getDb().transaction(() => {
    debitAvailable(request.userId, asset, request.amount);
    recordTransaction(request.userId, 'dex_bridge_lock', asset, request.amount, fee, 'pending', `bridge ${request.fromChain}->${request.toChain}`);
    getDb()
      .prepare(
        `INSERT INTO dex_bridge_transfers
           (transfer_id, user_id, from_chain, to_chain, asset, amount, bridge_fee, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(transferId, request.userId, request.fromChain, request.toChain, asset, request.amount, fee);
    const parts = applySchedule(fee, { lpBps: 0, vetgrBps: 0, treasuryBps: 10_000, insuranceBps: 0, burnBps: 0 });
    recordDexRevenue('dex_bridge_fee', asset, fee, parts, transferId);
  })();

  return { transferId, fee, receives };
}

/** Complete a bridge transfer, crediting the destination leg. */
export function releaseBridge(transferId: string, releaseTx: string): void {
  // A release completes an already-locked transfer, so it is never paused.
  const transfer = getDb()
    .prepare("SELECT * FROM dex_bridge_transfers WHERE transfer_id = ? AND status = 'pending'")
    .get(transferId) as
    | { transfer_id: string; user_id: string; asset: string; amount: number; bridge_fee: number }
    | undefined;
  if (!transfer) throw new DexError('NO_TRANSFER', 'no pending transfer with that id', 404);
  if (!releaseTx) throw new DexError('INVALID_TX', 'a release transaction reference is required', 400);

  const receives = transfer.amount - transfer.bridge_fee;
  getDb().transaction(() => {
    creditAvailable(transfer.user_id, transfer.asset, receives);
    recordTransaction(transfer.user_id, 'dex_bridge_release', transfer.asset, receives, 0, 'completed', `bridge ${transferId}`);
    getDb()
      .prepare("UPDATE dex_bridge_transfers SET status = 'completed', release_tx = ?, updated_at = datetime('now') WHERE transfer_id = ?")
      .run(releaseTx, transferId);
  })();
}

/** A user's bridge transfers. */
export function bridgeTransfers(userId: string): Array<Record<string, unknown>> {
  return getDb()
    .prepare('SELECT * FROM dex_bridge_transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId) as Array<Record<string, unknown>>;
}

/** The LBP weight and spot price of a live launch pool. */
export function lbpState(
  config: { startWeight: number; endWeight: number; startAt: number; endAt: number },
  balanceProject: number,
  balanceQuote: number,
  now = Date.now(),
): { weight: number; price: number } {
  const weight = lbpWeightAt(config, now);
  return { weight, price: lbpSpotPrice(balanceProject, balanceQuote, weight) };
}

export { bondingSellProceeds, allocateIdo };
