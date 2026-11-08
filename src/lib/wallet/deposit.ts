/**
 * Deposit address assignment.
 *
 * A deposit address is never invented. It is either the address already
 * recorded on the user's wallet row, or one derived deterministically from the
 * exchange's custody master seed at the user's own index. When no master seed
 * is configured the operation fails closed, because a fabricated address would
 * send a user's funds somewhere the exchange cannot spend from.
 *
 * The master seed is read from `TIGEREX_CUSTODY_MNEMONIC`; it is never logged
 * and never returned to a client.
 */

import { getDb, generateId } from '@/lib/db';
import { isEvmNetwork, deriveEvmAddress } from '@/lib/wallet/hd';
import { networkEnabled } from '@/lib/wallet/networks';

export class DepositError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface DepositAddress {
  asset: string;
  network: string;
  address: string;
  memo: string | null;
  /** True when the address was derived on this request rather than read back. */
  created: boolean;
}

function custodyMnemonic(): string | null {
  const value = process.env.TIGEREX_CUSTODY_MNEMONIC;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The next unused derivation index for a network.
 *
 * Indexes are allocated per network from the highest index already recorded, so
 * two users never share an address and a restart cannot reuse one.
 */
function nextIndex(network: string): number {
  const row = getDb()
    .prepare(
      `SELECT MAX(CAST(address_index AS INTEGER)) AS max_index
         FROM wallets
        WHERE network = ? AND address_index IS NOT NULL`,
    )
    .get(network) as { max_index: number | null } | undefined;
  const max = Number(row?.max_index);
  return Number.isFinite(max) && max >= 0 ? max + 1 : 0;
}

/**
 * The deposit address for an asset on a network, creating the wallet row and
 * deriving the address when it does not exist yet.
 */
export function depositAddress(userId: string, asset: string, network: string): DepositAddress {
  const upperAsset = String(asset ?? '').trim().toUpperCase();
  const upperNetwork = String(network ?? '').trim().toUpperCase();
  if (!upperAsset) throw new DepositError('VALIDATION_FAILED', 'An asset is required');
  if (!upperNetwork) throw new DepositError('VALIDATION_FAILED', 'A network is required');

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT wallet_id, address, memo FROM wallets
        WHERE user_id = ? AND currency = ? AND UPPER(network) = ?
        ORDER BY created_at LIMIT 1`,
    )
    .get(userId, upperAsset, upperNetwork) as
    | { wallet_id: string; address: string | null; memo: string | null }
    | undefined;

  if (existing?.address) {
    return { asset: upperAsset, network: upperNetwork, address: existing.address, memo: existing.memo ?? null, created: false };
  }

  // The asset/network pair must be listed active. This is checked before the
  // seed so a request for an unserved chain fails as a plain refusal rather
  // than a misleading custody error.
  if (!networkEnabled(upperAsset, upperNetwork)) {
    throw new DepositError(
      'UNSUPPORTED_NETWORK',
      `${upperAsset} deposits on ${upperNetwork} are not enabled`,
      409,
    );
  }

  const mnemonic = custodyMnemonic();
  if (!mnemonic) {
    throw new DepositError(
      'CUSTODY_NOT_CONFIGURED',
      'Deposit address generation is unavailable until the custody master seed is configured',
      503,
    );
  }

  if (!isEvmNetwork(upperNetwork)) {
    throw new DepositError(
      'UNSUPPORTED_NETWORK',
      `Deposit address derivation for ${upperNetwork} is not available; use the custody console to allocate one`,
      409,
    );
  }

  const index = nextIndex(upperNetwork);
  let address: string;
  try {
    address = deriveEvmAddress(mnemonic, index);
  } catch {
    // A malformed seed must not be reported as a user error.
    throw new DepositError('CUSTODY_UNAVAILABLE', 'The custody master seed could not be used', 503);
  }

  if (existing) {
    db.prepare(
      `UPDATE wallets SET address = ?, address_index = ?, updated_at = datetime('now') WHERE wallet_id = ?`,
    ).run(address, String(index), existing.wallet_id);
    return { asset: upperAsset, network: upperNetwork, address, memo: existing.memo ?? null, created: true };
  }

  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, address, address_index, status)
     VALUES (?, ?, 'funding', ?, ?, ?, ?, 'active')`,
  ).run(walletId, userId, upperAsset, upperNetwork, address, String(index));

  return { asset: upperAsset, network: upperNetwork, address, memo: null, created: true };
}

/** The deposit addresses the user already holds, for the deposit view. */
export function userDepositAddresses(userId: string): Array<{
  asset: string;
  network: string;
  address: string;
  memo: string | null;
}> {
  const rows = getDb()
    .prepare(
      `SELECT currency, network, address, memo FROM wallets
        WHERE user_id = ? AND address IS NOT NULL AND address <> ''
        ORDER BY currency, network`,
    )
    .all(userId) as Array<{ currency: string; network: string; address: string; memo: string | null }>;

  return rows.map((row) => ({
    asset: row.currency,
    network: row.network,
    address: row.address,
    memo: row.memo ?? null,
  }));
}
