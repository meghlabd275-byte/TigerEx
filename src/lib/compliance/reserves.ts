/**
 * Proof of reserves and ledger reconciliation.
 *
 * Two independent guarantees, both computed from the venue's own database:
 *
 *  - Proof of reserves: every user liability (each `(user, asset)` balance) is a
 *    leaf of a Merkle tree. Anyone can rebuild the root from the published
 *    commitments, and a user can prove a single balance is included without the
 *    tree revealing anyone else's holdings. The tree is deterministic, so two
 *    runs over the same data produce the same root.
 *  - Reconciliation: each asset's total user liability is compared against the
 *    assets the exchange actually records as held (treasury accounts). An asset
 *    whose recorded holdings do not cover its liabilities fails closed, and an
 *    asset with liabilities but no recorded holding is never treated as covered.
 *
 * Nothing here fabricates a number: a missing row is a zero, and a shortfall is
 * reported as a shortfall rather than smoothed over.
 */

import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';

/** A liability is a hair under a rounded amount, so compare with a tolerance. */
function covers(recorded: number, liabilities: number): boolean {
  const tolerance = Math.max(1e-8, Math.abs(liabilities) * 1e-9);
  return recorded + tolerance >= liabilities;
}

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hexToBuf(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

/** Order-independent pair hash: sorting both sides keeps build and verify in
 *  step regardless of sibling order, so a proof cannot be rejected for a
 *  cosmetic ordering difference. */
function hashPair(a: string, b: string): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return sha256Hex(Buffer.concat([hexToBuf(x), hexToBuf(y)]));
}

/** A constant leaf used to pad the tree to a power of two, so every internal
 *  node has two children and a proof is the same shape for every leaf. */
const PAD_LEAF = sha256Hex('tigerex:merkle:padding:v1');
const EMPTY_ROOT = sha256Hex('tigerex:merkle:empty:v1');

export interface LiabilityLeaf {
  userId: string;
  asset: string;
  amount: number;
}

/** Deterministic leaf hash for a single liability. */
export function liabilityLeafHash(userId: string, asset: string, amount: number): string {
  return sha256Hex(`tigerex:liability:v1:${userId}:${asset}:${amount.toFixed(8)}`);
}

interface MerkleTree {
  root: string;
  layers: string[][];
}

/** Build a padded Merkle tree from leaf hashes. */
function buildTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) return { root: EMPTY_ROOT, layers: [[]] };
  let size = 1;
  while (size < leaves.length) size *= 2;
  let layer = leaves.slice();
  while (layer.length < size) layer.push(PAD_LEAF);
  const layers: string[][] = [layer];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(hashPair(layer[i], layer[i + 1]));
    layers.push(next);
    layer = next;
  }
  return { root: layer[0], layers };
}

/** Sibling path for the leaf at `index`, from the bottom layer up. */
function proofFor(tree: MerkleTree, index: number): string[] {
  const siblings: string[] = [];
  let idx = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    siblings.push(tree.layers[level][idx ^ 1]);
    idx >>= 1;
  }
  return siblings;
}

/** Recompute the root from a leaf and its proof. */
export function verifyMerkleProof(leaf: string, siblings: string[], root: string): boolean {
  let hash = leaf;
  for (const sibling of siblings) hash = hashPair(hash, sibling);
  return hash === root;
}

export interface AssetLiability {
  asset: string;
  totalLiabilities: number;
  userCount: number;
}

export interface ReservesReport {
  generatedAt: string;
  leafCount: number;
  merkleRoot: string;
  assets: AssetLiability[];
  /** When requested, one entry per leaf with its proof, so it can be published. */
  proofs?: Array<{ leafHash: string; asset: string; siblings: string[] }>;
}

/** Read every positive user liability, aggregated per user and asset. */
function readLiabilities(): LiabilityLeaf[] {
  const rows = getDb()
    .prepare(
      `SELECT w.user_id AS user_id, b.currency AS asset, SUM(b.available + b.locked) AS amount
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        GROUP BY w.user_id, b.currency
       HAVING SUM(b.available + b.locked) > 0
        ORDER BY w.user_id, b.currency`,
    )
    .all() as Array<{ user_id: string; asset: string; amount: number }>;
  return rows.map((row) => ({
    userId: row.user_id,
    asset: row.asset,
    amount: Number(row.amount),
  }));
}

/**
 * Build the proof-of-reserves report from the live ledger.
 *
 * The Merkle root commits to every user's balance; the per-asset totals are the
 * aggregate liabilities the exchange owes.
 */
export function buildReservesReport(options: { includeProofs?: boolean } = {}): ReservesReport {
  const liabilities = readLiabilities();
  const leaves = liabilities.map((l) => liabilityLeafHash(l.userId, l.asset, l.amount));
  const tree = buildTree(leaves);

  const byAsset = new Map<string, { total: number; users: number }>();
  for (const l of liabilities) {
    const entry = byAsset.get(l.asset) ?? { total: 0, users: 0 };
    entry.total += l.amount;
    entry.users += 1;
    byAsset.set(l.asset, entry);
  }

  const report: ReservesReport = {
    generatedAt: new Date().toISOString(),
    leafCount: leaves.length,
    merkleRoot: tree.root,
    assets: [...byAsset.entries()]
      .map(([asset, v]) => ({ asset, totalLiabilities: v.total, userCount: v.users }))
      .sort((a, b) => a.asset.localeCompare(b.asset)),
  };

  if (options.includeProofs) {
    report.proofs = liabilities.map((l, i) => ({
      leafHash: leaves[i],
      asset: l.asset,
      siblings: proofFor(tree, i),
    }));
  }

  return report;
}

export interface ReconciliationEntry {
  asset: string;
  userLiabilities: number;
  recordedAssets: number;
  surplus: number;
  covered: boolean;
}

export interface ReconciliationResult {
  generatedAt: string;
  ok: boolean;
  entries: ReconciliationEntry[];
}

/** Recorded exchange holdings per asset, from the treasury accounts. */
function readRecordedAssets(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT asset AS asset, SUM(balance) AS held
         FROM treasury_accounts
        GROUP BY asset
       HAVING SUM(balance) <> 0`,
    )
    .all() as Array<{ asset: string; held: number }>;
  const held = new Map<string, number>();
  for (const row of rows) held.set(row.asset, Number(row.held));
  return held;
}

/**
 * Reconcile user liabilities against recorded exchange holdings.
 *
 * `ok` is true only when every asset that carries a user liability is covered by
 * recorded holdings. An asset with liabilities but no recorded holding is a
 * shortfall, never a pass.
 */
export function runReconciliation(): ReconciliationResult {
  const liabilities = buildReservesReport().assets;
  const recorded = readRecordedAssets();

  const entries: ReconciliationEntry[] = liabilities.map((row) => {
    const held = recorded.get(row.asset) ?? 0;
    return {
      asset: row.asset,
      userLiabilities: row.totalLiabilities,
      recordedAssets: held,
      surplus: held - row.totalLiabilities,
      covered: covers(held, row.totalLiabilities),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    ok: entries.length > 0 && entries.every((e) => e.covered),
    entries,
  };
}
