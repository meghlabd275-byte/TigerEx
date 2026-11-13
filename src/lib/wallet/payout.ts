/**
 * On-chain withdrawal settlement.
 *
 * A withdrawal is broadcast from the exchange's own custody key for the user's
 * deposit address on the chain the withdrawal names. The signed transaction is
 * built and signed locally and then handed to the node's `eth_sendRawTransaction`;
 * the private key never leaves this process and is never logged or stored.
 *
 * Settlement is split into two steps so a crash cannot lose or double-count
 * funds:
 *
 * - `broadcastWithdrawal` signs, sends, consumes the user's reservation in one
 *   database transaction, and records the chain transaction. A withdrawal that
 *   has already been broadcast is never broadcast again.
 * - `syncBroadcastWithdrawals` watches a broadcast transaction until it is mined.
 *   A confirmed transaction settles the withdrawal; a reverted one returns the
 *   consumed amount to the user's available balance.
 *
 * The module is free of `next/server` so the transaction builder can be unit
 * tested against a known key.
 */

import { getDb, generateId } from '@/lib/db';
import { consumeLocked, creditAvailable, recordTransaction } from '@/lib/db/ledger';
import { recordWithdrawal, reverseWithdrawal } from '@/lib/db/accounting';
import { getChain, listTokens, ChainRecord, TokenRecord } from '@/lib/chains/registry';
import {
  EvmRpcError,
  JsonRpcOptions,
  encodeTransfer,
  isHexAddress,
  rpcEstimateGas,
  rpcGasPrice,
  rpcTransactionCount,
  rpcSendRawTransaction,
  rpcTransactionReceipt,
  rpcBlockNumber,
} from '@/lib/chains/evm-rpc';
import { deriveEvmPrivateKey } from '@/lib/wallet/hd';

export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Expand a JS number's shortest decimal representation into integer and
 * fraction digit strings, handling scientific notation.
 *
 * `toFixed` is avoided because it renders `0.1` as `0.100000000000000006`: the
 * binary value is not exactly a tenth, so padding to 18 places exposes the
 * error. `toString` returns the shortest string that round-trips, which is the
 * value the operator actually meant.
 */
function decimalParts(value: number): { int: string; frac: string } {
  const text = value.toString().toLowerCase();
  if (!text.includes('e')) {
    const [int, frac = ''] = text.split('.');
    return { int, frac };
  }

  const [mantissa, expText] = text.split('e');
  const exp = Number.parseInt(expText, 10);
  const [intPart, fracPart = ''] = mantissa.split('.');
  const digits = `${intPart}${fracPart}`;
  const point = intPart.length + exp;

  if (point <= 0) return { int: '0', frac: `${'0'.repeat(-point)}${digits}` };
  if (point >= digits.length) return { int: `${digits}${'0'.repeat(point - digits.length)}`, frac: '' };
  return { int: digits.slice(0, point), frac: digits.slice(point) };
}

/** Convert a human-unit amount to base units without floating-point drift. */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PayoutError('INVALID_AMOUNT', 'A non-negative amount is required');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new PayoutError('INVALID_DECIMALS', 'decimals must be an integer between 0 and 255');
  }

  const { int, frac } = decimalParts(amount);

  let kept = frac.slice(0, decimals).padEnd(decimals, '0');
  // Round half up on the first dropped digit rather than truncating, so a value
  // with more precision than the asset carries is not silently under-sent.
  const dropped = frac.slice(decimals);
  if (dropped.length > 0 && dropped.charCodeAt(0) >= 0x35 /* '5' */) {
    kept = (BigInt(kept || '0') + 1n).toString().padStart(decimals, '0');
  }

  const digits = `${int}${kept}`.replace(/^0+/, '') || '0';
  return BigInt(digits);
}

export interface PayoutRequest {
  from: string;
  to: string;
  /** Base-unit amount of the asset to deliver (the net amount). */
  amount: bigint;
  /** ERC-20 contract address, or null for the chain's native coin. */
  tokenContract: string | null;
  nonce: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  chainId: number;
}

/** Sign a payout transaction locally. Returns the raw transaction hex. */
export async function signPayout(privateKey: string, request: PayoutRequest): Promise<string> {
  // Imported lazily so the module's pure helpers can be exercised without
  // pulling the signing library into the test process.
  const { Wallet } = await import('ethers');
  const wallet = new Wallet(privateKey);

  const tx = request.tokenContract
    ? {
        to: request.tokenContract,
        value: 0n,
        data: encodeTransfer(request.to, request.amount),
        nonce: Number(request.nonce),
        gasPrice: request.gasPrice,
        gasLimit: request.gasLimit,
        chainId: request.chainId,
        type: 0,
      }
    : {
        to: request.to,
        value: request.amount,
        nonce: Number(request.nonce),
        gasPrice: request.gasPrice,
        gasLimit: request.gasLimit,
        chainId: request.chainId,
        type: 0,
      };

  return wallet.signTransaction(tx);
}

function custodyMnemonic(): string | null {
  const value = process.env.TIGEREX_CUSTODY_MNEMONIC;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The custody key index for the user's wallet on a chain.
 *
 * A withdrawal is sent from the user's own custody address — the address their
 * deposits land in — so the key is the one recorded on that wallet row. When the
 * withdrawal recorded its wallet, that row is used directly; otherwise the row
 * is found by user, asset and network. The destination address is never used:
 * it is external and the exchange holds no key for it.
 */
function walletIndex(
  userId: string,
  chainKey: string,
  asset: string,
  walletId: string | null,
): number {
  const raw = walletId
    ? (getDb()
        .prepare('SELECT address_index FROM wallets WHERE wallet_id = ?')
        .get(walletId) as { address_index: string | null } | undefined)
    : (getDb()
        .prepare(
          `SELECT address_index FROM wallets
            WHERE user_id = ? AND currency = ? AND UPPER(network) = ?
            ORDER BY created_at LIMIT 1`,
        )
        .get(userId, asset.toUpperCase(), chainKey.toUpperCase()) as
        | { address_index: string | null }
        | undefined);

  // A NULL index is not index 0: `Number(null)` is 0, so a row with no recorded
  // key would otherwise sign with the first key in the seed. Require an explicit
  // integer.
  const stored = raw?.address_index;
  const index = stored === null || stored === undefined ? NaN : Number(stored);
  if (!Number.isInteger(index) || index < 0) {
    throw new PayoutError(
      'CUSTODY_KEY_UNAVAILABLE',
      'No custody key is recorded for this user and asset; issue a deposit address first',
      503,
    );
  }
  return index;
}

function tokenFor(chainKey: string, asset: string): TokenRecord | null {
  const symbol = asset.toUpperCase();
  return listTokens(chainKey).find((t) => t.symbol.toUpperCase() === symbol && t.status === 'active') ?? null;
}

function decimalsFor(chain: ChainRecord, asset: string, token: TokenRecord | null): number {
  if (token) return token.decimals;
  if (asset.toUpperCase() === chain.nativeSymbol.toUpperCase()) return chain.nativeDecimals;
  throw new PayoutError('UNKNOWN_ASSET', `${asset} is not a listed token on ${chain.name}`, 409);
}

export interface BroadcastResult {
  withdrawalId: string;
  txHash: string;
}

/**
 * Allocate the next transaction nonce for a hot-wallet address.
 *
 * The chain's own `pending` nonce is the floor, so an allocation never reuses a
 * nonce the node has already seen. On top of that floor the allocator keeps a
 * monotonic counter per (chain, address) and advances it inside one write
 * transaction, so two payouts signed from the same address in the same instant
 * receive different nonces. Without this, both would read the same
 * `eth_getTransactionCount` and sign the same nonce: the chain accepts one and
 * drops the other, and the dropped withdrawal is recorded as broadcast while
 * the funds never leave.
 */
function allocateNonce(chainKey: string, address: string, rpcNonce: bigint): bigint {
  const db = getDb();
  const key = address.toLowerCase();
  // How far the local counter may run ahead of the node's pending nonce before
  // it is treated as stale. A transaction that was dropped from the mempool
  // never lands, so without this the counter would hold a permanent gap and
  // every later payout would queue behind it forever.
  const drift = Number(process.env.TIGEREX_NONCE_MAX_DRIFT);
  const maxDrift = Number.isInteger(drift) && drift > 0 ? BigInt(drift) : 16n;

  return db.transaction(() => {
    const row = db
      .prepare('SELECT next_nonce FROM chain_nonces WHERE chain_key = ? AND address = ?')
      .get(chainKey, key) as { next_nonce: number } | undefined;

    let candidate = rpcNonce;
    if (row) {
      const stored = BigInt(row.next_nonce);
      if (stored <= rpcNonce) {
        candidate = rpcNonce;
      } else if (stored - rpcNonce > maxDrift) {
        // The counter is too far ahead of the chain: assume the intervening
        // transactions were dropped and resynchronise to the node.
        candidate = rpcNonce;
      } else {
        candidate = stored;
      }
    }

    db.prepare(
      `INSERT INTO chain_nonces (chain_key, address, next_nonce, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(chain_key, address) DO UPDATE SET next_nonce = excluded.next_nonce, updated_at = datetime('now')`,
    ).run(chainKey, key, Number(candidate + 1n));

    return candidate;
  })();
}

/**
 * Sign and broadcast a pending withdrawal.
 *
 * The reservation is consumed in the same transaction that records the hash, so
 * the ledger and the chain transaction move together. A withdrawal already in
 * `broadcast` is refused, which is what prevents a double send.
 */
export async function broadcastWithdrawal(
  withdrawalId: string,
  options: JsonRpcOptions = {},
): Promise<BroadcastResult> {
  const db = getDb();
  const withdrawal = db
    .prepare(
      `SELECT withdrawal_id, user_id, currency, network, amount, fee, address, wallet_id, status
         FROM withdrawals WHERE withdrawal_id = ?`,
    )
    .get(withdrawalId) as
    | {
        withdrawal_id: string;
        user_id: string;
        currency: string;
        network: string;
        amount: number;
        fee: number;
        address: string;
        wallet_id: string | null;
        status: string;
      }
    | undefined;

  if (!withdrawal) throw new PayoutError('UNKNOWN_WITHDRAWAL', 'No such withdrawal', 404);
  if (withdrawal.status === 'broadcast' || withdrawal.status === 'completed') {
    throw new PayoutError('ALREADY_BROADCAST', 'This withdrawal has already been broadcast', 409);
  }
  if (withdrawal.status !== 'pending') {
    throw new PayoutError('NOT_PENDING', `This withdrawal is ${withdrawal.status}`, 409);
  }
  if (!isHexAddress(withdrawal.address)) {
    throw new PayoutError('INVALID_ADDRESS', 'The withdrawal address is not a valid EVM address', 409);
  }

  const chainKey = String(withdrawal.network).toLowerCase();
  const chain = getChain(chainKey);
  if (!chain) throw new PayoutError('UNKNOWN_CHAIN', `No chain is configured for network ${withdrawal.network}`, 409);
  if (chain.chainType !== 'evm') {
    throw new PayoutError('CHAIN_NOT_EVM', 'On-chain settlement is only implemented for EVM chains', 409);
  }

  const mnemonic = custodyMnemonic();
  if (!mnemonic) {
    throw new PayoutError('CUSTODY_NOT_CONFIGURED', 'Withdrawal settlement is unavailable until the custody master seed is configured', 503);
  }

  const token = tokenFor(chainKey, withdrawal.currency);
  const decimals = decimalsFor(chain, withdrawal.currency, token);
  const amountBase = toBaseUnits(Number(withdrawal.amount), decimals);

  // A withdrawal is signed with the user's own custody key — the key behind the
  // deposit address their funds arrived at — and sent from that address. The
  // destination address is external and the exchange holds no key for it.
  const index = walletIndex(withdrawal.user_id, chainKey, withdrawal.currency, withdrawal.wallet_id);
  const privateKey = deriveEvmPrivateKey(mnemonic, index);

  const { Wallet } = await import('ethers');
  const from = new Wallet(privateKey).address;

  const nonce = allocateNonce(chainKey, from, await rpcTransactionCount(chain.rpcUrl, from, options));
  const gasPrice = await rpcGasPrice(chain.rpcUrl, options);

  let gasLimit: bigint;
  try {
    gasLimit = await rpcEstimateGas(
      chain.rpcUrl,
      token
        ? { from, to: token.contractAddress as string, data: encodeTransfer(withdrawal.address, amountBase) }
        : { from, to: withdrawal.address, value: amountBase },
      options,
    );
  } catch (error) {
    throw new PayoutError(
      'GAS_ESTIMATE_FAILED',
      error instanceof EvmRpcError ? error.message : 'The payout could not be estimated',
      502,
    );
  }
  // A 20% headroom so a small state change between estimate and mine does not
  // run the transaction out of gas.
  const gasLimitWithHeadroom = (gasLimit * 120n) / 100n;

  const rawTx = await signPayout(privateKey, {
    from,
    to: withdrawal.address,
    amount: amountBase,
    tokenContract: token?.contractAddress ?? null,
    nonce,
    gasPrice,
    gasLimit: gasLimitWithHeadroom,
    chainId: chain.chainId,
  });

  const txHash = await rpcSendRawTransaction(chain.rpcUrl, rawTx, options);

  const total = Number(withdrawal.amount) + Number(withdrawal.fee || 0);

  db.transaction(() => {
    // Guarded so a concurrent broadcast cannot consume the reservation twice.
    const claimed = db
      .prepare("UPDATE withdrawals SET status = 'broadcast', tx_hash = ? WHERE withdrawal_id = ? AND status = 'pending'")
      .run(txHash, withdrawalId);
    if (claimed.changes !== 1) {
      throw new PayoutError('ALREADY_BROADCAST', 'This withdrawal was broadcast by another request', 409);
    }

    consumeLocked(withdrawal.user_id, withdrawal.currency.toUpperCase(), total, 'spot');
    recordWithdrawal(withdrawal.user_id, withdrawal.currency.toUpperCase(), total, `Withdrawal ${txHash}`);
    recordTransaction(
      withdrawal.user_id,
      'withdrawal',
      withdrawal.currency.toUpperCase(),
      -Number(withdrawal.amount),
      Number(withdrawal.fee || 0),
      'pending',
      `On-chain withdrawal ${txHash}`,
    );

    db.prepare(
      `INSERT INTO chain_transactions
         (tx_id, direction, reference_id, chain_key, tx_hash, from_address, to_address, asset, amount, status)
       VALUES (?, 'withdrawal', ?, ?, ?, ?, ?, ?, ?, 'broadcast')`,
    ).run(generateId(), withdrawalId, chainKey, txHash, from, withdrawal.address, withdrawal.currency.toUpperCase(), String(withdrawal.amount));
  })();

  return { withdrawalId, txHash };
}

export interface SyncResult {
  confirmed: number;
  failed: number;
}

/**
 * Advance broadcast withdrawals by their on-chain confirmations.
 *
 * A confirmed transaction marks the withdrawal `completed`; a reverted one
 * returns the reservation and marks it `failed`. The reservation is only
 * returned on a revert, which is the one case where the funds never left.
 */
export async function syncBroadcastWithdrawals(options: JsonRpcOptions = {}): Promise<SyncResult> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT withdrawal_id, user_id, currency, network, amount, fee, tx_hash
         FROM withdrawals
        WHERE status = 'broadcast' AND tx_hash IS NOT NULL
        ORDER BY processed_at
        LIMIT 500`,
    )
    .all() as Array<{
    withdrawal_id: string;
    user_id: string;
    currency: string;
    network: string;
    amount: number;
    fee: number;
    tx_hash: string;
  }>;

  let confirmed = 0;
  let failed = 0;

  for (const row of rows) {
    const chain = getChain(String(row.network).toLowerCase());
    if (!chain || chain.chainType !== 'evm') continue;

    let receipt: { status: string; blockNumber: string } | null;
    try {
      receipt = await rpcTransactionReceipt(chain.rpcUrl, row.tx_hash, options);
    } catch {
      continue;
    }
    if (!receipt) continue;

    if (receipt.status !== '0x1') {
      const total = Number(row.amount) + Number(row.fee || 0);
      db.transaction(() => {
        const claimed = db
          .prepare("UPDATE withdrawals SET status = 'failed' WHERE withdrawal_id = ? AND status = 'broadcast'")
          .run(row.withdrawal_id);
        if (claimed.changes !== 1) return;
        // The reservation was consumed when the transaction was broadcast, so a
        // revert returns it to available. It must never be unlocked: `locked` no
        // longer holds it, and unlocking would both fail the balance check and
        // move an unrelated reservation.
        creditAvailable(row.user_id, row.currency.toUpperCase(), total, 'spot');
        reverseWithdrawal(row.user_id, row.currency.toUpperCase(), total, `Withdrawal ${row.tx_hash} reverted`);
        recordTransaction(
          row.user_id,
          'withdrawal',
          row.currency.toUpperCase(),
          total,
          0,
          'failed',
          `Withdrawal ${row.withdrawal_id} reverted on chain`,
        );
        db.prepare(
          "UPDATE chain_transactions SET status = 'failed', error = 'transaction reverted', updated_at = datetime('now') WHERE reference_id = ?",
        ).run(row.withdrawal_id);
      })();
      failed += 1;
      continue;
    }

    const head = Number(await rpcBlockNumber(chain.rpcUrl, options));
    const confirmations = Math.max(0, head - Number(BigInt(receipt.blockNumber)) + 1);
    const required = requiredConfirmations(row.currency, row.network);
    db.prepare(
      `UPDATE chain_transactions SET confirmations = ?, block_number = ?, updated_at = datetime('now') WHERE reference_id = ?`,
    ).run(confirmations, Number(BigInt(receipt.blockNumber)), row.withdrawal_id);

    if (confirmations < required) continue;

    db.prepare(
      "UPDATE withdrawals SET status = 'completed', processed_at = datetime('now') WHERE withdrawal_id = ? AND status = 'broadcast'",
    ).run(row.withdrawal_id);
    db.prepare(
      "UPDATE chain_transactions SET status = 'confirmed', updated_at = datetime('now') WHERE reference_id = ?",
    ).run(row.withdrawal_id);
    confirmed += 1;
  }

  return { confirmed, failed };
}

function requiredConfirmations(asset: string, network: string): number {
  const row = getDb()
    .prepare('SELECT confirmations FROM deposit_networks WHERE asset = ? AND UPPER(network) = ?')
    .get(asset, String(network).toUpperCase()) as { confirmations: number } | undefined;
  const value = Number(row?.confirmations);
  if (Number.isInteger(value) && value >= 0) return value;
  const fallback = Number(process.env.TIGEREX_DEFAULT_CONFIRMATIONS);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : 12;
}
