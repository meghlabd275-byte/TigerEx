/**
 * Deposit network configuration and validation.
 *
 * Which asset may be deposited on which chain is operator configuration stored
 * in `deposit_networks`, not a list compiled into the code. This module owns
 * the rules (free of `next/server` so it can be unit tested) and the database
 * access; the routes are thin wrappers.
 *
 * An address is only issued for an asset/network pair that is listed active
 * here. That keeps the deposit view and the address issuer in agreement, and
 * stops a client from talking the exchange into deriving an address on a chain
 * it does not serve.
 */

import { getDb, generateId } from '@/lib/db';

export class NetworkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface DepositNetwork {
  asset: string;
  network: string;
  displayName: string;
  minDeposit: number;
  confirmations: number;
  memoRequired: boolean;
  status: string;
}

export type NetworkValidation =
  | { network: DepositNetwork }
  | { error: string };

const ASSET_RE = /^[A-Z0-9]{1,20}$/;
const NETWORK_RE = /^[A-Z0-9_-]{1,40}$/;
const STATUSES = ['active', 'paused', 'delisting'];

/**
 * Validate a deposit-network listing request.
 *
 * The checks are strict because a bad row silently breaks deposits: a zero or
 * negative minimum would accept a dust credit, a fractional confirmation count
 * would never be reached, and a status outside the known set would be treated
 * as "not active" by the deposit view while looking enabled in the console.
 */
export function validateNetworkInput(body: Record<string, unknown>): NetworkValidation {
  const asset = String(body.asset ?? '').trim().toUpperCase();
  if (!ASSET_RE.test(asset)) return { error: 'asset must be 1-20 letters or digits, for example BTC' };

  const network = String(body.network ?? '').trim().toUpperCase();
  if (!NETWORK_RE.test(network)) return { error: 'network must be 1-40 letters, digits, dash or underscore, for example ERC20' };

  const displayName = String(body.displayName ?? body.display_name ?? '').trim();
  if (displayName.length === 0) return { error: 'displayName is required' };
  if (displayName.length > 80) return { error: 'displayName must be at most 80 characters' };

  const minDeposit = Number(body.minDeposit ?? body.min_deposit);
  if (!Number.isFinite(minDeposit) || minDeposit <= 0) {
    return { error: 'minDeposit must be a positive number' };
  }

  const rawConfirmations = Number(body.confirmations);
  if (!Number.isInteger(rawConfirmations) || rawConfirmations < 0 || rawConfirmations > 10000) {
    return { error: 'confirmations must be an integer between 0 and 10000' };
  }

  const memoRequired = body.memoRequired === true || body.memo_required === true || body.memoRequired === 1;

  const status = String(body.status ?? 'active').toLowerCase();
  if (!STATUSES.includes(status)) {
    return { error: 'status must be one of active, paused, delisting' };
  }

  return {
    network: {
      asset,
      network,
      displayName,
      minDeposit,
      confirmations: rawConfirmations,
      memoRequired,
      status,
    },
  };
}

function toPublic(row: Record<string, unknown>): DepositNetwork {
  return {
    asset: String(row.asset),
    network: String(row.network),
    displayName: String(row.display_name ?? ''),
    minDeposit: Number(row.min_deposit) || 0,
    confirmations: Number(row.confirmations) || 0,
    memoRequired: Number(row.memo_required) === 1,
    status: String(row.status ?? 'active'),
  };
}

/** Every listed deposit network, active ones first then by asset and chain. */
export function listNetworks(options: { status?: string } = {}): DepositNetwork[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status.toLowerCase());
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM deposit_networks${where} ORDER BY asset, network`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(toPublic);
}

/** The active networks an asset can be deposited on. */
export function activeNetworksFor(asset: string): DepositNetwork[] {
  const upper = String(asset ?? '').trim().toUpperCase();
  if (!upper) return [];
  const rows = getDb()
    .prepare("SELECT * FROM deposit_networks WHERE asset = ? AND status = 'active' ORDER BY network")
    .all(upper) as Array<Record<string, unknown>>;
  return rows.map(toPublic);
}

/**
 * Whether an asset may be deposited on a network.
 *
 * Used by the address issuer before it derives anything. An unknown or paused
 * pair returns false, so the caller refuses the request rather than deriving an
 * address for a chain the exchange does not serve.
 */
export function networkEnabled(asset: string, network: string): boolean {
  const upperAsset = String(asset ?? '').trim().toUpperCase();
  const upperNetwork = String(network ?? '').trim().toUpperCase();
  if (!upperAsset || !upperNetwork) return false;
  const row = getDb()
    .prepare("SELECT 1 FROM deposit_networks WHERE asset = ? AND network = ? AND status = 'active'")
    .get(upperAsset, upperNetwork);
  return !!row;
}

/** Add or update a deposit network. Returns the stored row. */
export function upsertNetwork(body: Record<string, unknown>): DepositNetwork {
  const validated = validateNetworkInput(body);
  if ('error' in validated) throw new NetworkError('VALIDATION_FAILED', validated.error);
  const { network } = validated;

  const db = getDb();
  const existing = db
    .prepare('SELECT network_id FROM deposit_networks WHERE asset = ? AND network = ?')
    .get(network.asset, network.network) as { network_id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE deposit_networks
          SET display_name = ?, min_deposit = ?, confirmations = ?, memo_required = ?, status = ?, updated_at = datetime('now')
        WHERE network_id = ?`,
    ).run(
      network.displayName,
      network.minDeposit,
      network.confirmations,
      network.memoRequired ? 1 : 0,
      network.status,
      existing.network_id,
    );
  } else {
    db.prepare(
      `INSERT INTO deposit_networks
         (network_id, asset, network, display_name, min_deposit, confirmations, memo_required, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      generateId(),
      network.asset,
      network.network,
      network.displayName,
      network.minDeposit,
      network.confirmations,
      network.memoRequired ? 1 : 0,
      network.status,
    );
  }

  return network;
}

/**
 * Remove a deposit network.
 *
 * Refused when a wallet already holds an address on that chain for the asset:
 * deleting the listing would strand those deposit addresses with no entry in
 * the deposit view, so the operator must pause it instead.
 */
export function removeNetwork(asset: string, network: string): void {
  const upperAsset = String(asset ?? '').trim().toUpperCase();
  const upperNetwork = String(network ?? '').trim().toUpperCase();
  const db = getDb();
  const row = db
    .prepare('SELECT network_id FROM deposit_networks WHERE asset = ? AND network = ?')
    .get(upperAsset, upperNetwork) as { network_id: string } | undefined;
  if (!row) throw new NetworkError('NOT_FOUND', 'That deposit network is not listed', 404);

  const inUse = db
    .prepare('SELECT 1 FROM wallets WHERE currency = ? AND UPPER(network) = ? LIMIT 1')
    .get(upperAsset, upperNetwork);
  if (inUse) {
    throw new NetworkError(
      'NETWORK_IN_USE',
      'Deposit addresses already exist on this network; pause it instead of removing it',
      409,
    );
  }

  db.prepare('DELETE FROM deposit_networks WHERE network_id = ?').run(row.network_id);
}
