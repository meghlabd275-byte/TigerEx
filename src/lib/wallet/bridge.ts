/**
 * Cross-chain transfers.
 *
 * A bridge transfer debits the caller's balance on the source chain and records
 * the destination chain and address. The destination address is validated with
 * the same chain-aware validator the withdrawal path uses, so a transfer cannot
 * be recorded to an address that does not exist on the target chain.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, recordTransaction, LedgerError } from '@/lib/db/ledger';
import { recordBridgeOut } from '@/lib/db/accounting';
import { validateAddress } from '@/lib/wallet/address';

export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Chains the bridge supports, keyed by the name a client sends. */
const CHAIN_ALIASES: Record<string, string> = {
  ETH: 'ETH',
  ETHEREUM: 'ETH',
  BSC: 'BSC',
  BNB: 'BSC',
  POLYGON: 'POLYGON',
  MATIC: 'POLYGON',
  SOL: 'SOL',
  SOLANA: 'SOL',
  ARBITRUM: 'ARBITRUM',
  ARB: 'ARBITRUM',
  OPTIMISM: 'OPTIMISM',
  OP: 'OPTIMISM',
  BASE: 'BASE',
  TRON: 'TRON',
  AVALANCHE: 'AVALANCHE',
  AVAX: 'AVALANCHE',
};

export interface CrossChainTransfer {
  transferId: string;
  transfer_id: string;
  asset: string;
  amount: number;
  fromChain: string;
  from_chain: string;
  toChain: string;
  to_chain: string;
  toAddress: string;
  to_address: string;
  fee: number;
  status: string;
  txRef: string | null;
  tx_ref: string | null;
  createdAt: string;
  created_at: string;
}

function toView(row: Record<string, unknown>): CrossChainTransfer {
  return {
    transferId: String(row.transfer_id),
    transfer_id: String(row.transfer_id),
    asset: String(row.asset),
    amount: Number(row.amount),
    fromChain: String(row.from_chain),
    from_chain: String(row.from_chain),
    toChain: String(row.to_chain),
    to_chain: String(row.to_chain),
    toAddress: String(row.to_address),
    to_address: String(row.to_address),
    fee: Number(row.fee),
    status: String(row.status),
    txRef: row.tx_ref === null || row.tx_ref === undefined ? null : String(row.tx_ref),
    tx_ref: row.tx_ref === null || row.tx_ref === undefined ? null : String(row.tx_ref),
    createdAt: String(row.created_at),
    created_at: String(row.created_at),
  };
}

function normalizeChain(chain: string): string {
  const key = String(chain ?? '').trim().toUpperCase();
  const resolved = CHAIN_ALIASES[key];
  if (!resolved) throw new BridgeError('UNSUPPORTED_CHAIN', `${chain || 'That chain'} is not supported by the bridge`);
  return resolved;
}

/** A flat bridge fee, in the transferred asset, charged on every transfer. */
export const BRIDGE_FEE_RATE = 0.001;

/**
 * Initiate a bridge transfer.
 *
 * The asset is debited on the source side immediately, so the same funds cannot
 * be bridged twice. The destination address is validated for the target chain;
 * an address the exchange cannot check is refused.
 */
export function initiateTransfer(input: {
  userId: string;
  fromChain: string;
  toChain: string;
  asset: string;
  amount: number;
  toAddress: string;
}): CrossChainTransfer {
  const asset = String(input.asset ?? '').trim().toUpperCase();
  if (!asset) throw new BridgeError('VALIDATION_FAILED', 'An asset is required');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new BridgeError('VALIDATION_FAILED', 'amount must be a positive number');
  }

  const fromChain = normalizeChain(input.fromChain);
  const toChain = normalizeChain(input.toChain);
  if (fromChain === toChain) throw new BridgeError('VALIDATION_FAILED', 'fromChain and toChain must differ');

  const address = String(input.toAddress ?? '').trim();
  if (!address) throw new BridgeError('VALIDATION_FAILED', 'toAddress is required');
  const validation = validateAddress(toChain, address);
  if (!validation.valid) {
    throw new BridgeError('INVALID_ADDRESS', validation.reason ?? 'The destination address is not valid for this chain');
  }

  const fee = input.amount * BRIDGE_FEE_RATE;
  const total = input.amount + fee;
  const transferId = generateId();
  const db = getDb();

  try {
    db.transaction(() => {
      debitAvailable(input.userId, asset, total);
      recordBridgeOut(input.userId, asset, input.amount, fee, `Bridge ${transferId} ${fromChain}->${toChain}`);
      recordTransaction(
        input.userId,
        'bridge_out',
        asset,
        total,
        fee,
        'pending',
        `Bridge ${transferId} ${fromChain}->${toChain}`,
      );
      db.prepare(
        `INSERT INTO cross_chain_transfers
           (transfer_id, user_id, asset, amount, from_chain, to_chain, to_address, fee, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      ).run(transferId, input.userId, asset, input.amount, fromChain, toChain, validation.normalized ?? address, fee);
    })();
  } catch (error) {
    if (error instanceof LedgerError) {
      if (error.code === 'INSUFFICIENT_BALANCE') {
        throw new BridgeError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`, 400);
      }
      throw new BridgeError(error.code, error.message, error.status);
    }
    throw error;
  }

  const row = db.prepare('SELECT * FROM cross_chain_transfers WHERE transfer_id = ?').get(transferId) as Record<
    string,
    unknown
  >;
  return toView(row);
}

/** One of the caller's transfers, or null when it does not exist for them. */
export function transferStatus(userId: string, transferId: string): CrossChainTransfer | null {
  const row = getDb()
    .prepare('SELECT * FROM cross_chain_transfers WHERE transfer_id = ? AND user_id = ?')
    .get(String(transferId ?? '').trim(), userId) as Record<string, unknown> | undefined;
  return row ? toView(row) : null;
}

/** The caller's own bridge history, newest first. */
export function transferHistory(userId: string, limit = 50): CrossChainTransfer[] {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;
  const rows = getDb()
    .prepare('SELECT * FROM cross_chain_transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, bounded) as Array<Record<string, unknown>>;
  return rows.map(toView);
}
