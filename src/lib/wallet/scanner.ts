/**
 * On-chain deposit scanner.
 *
 * The scanner watches each EVM chain the operator has listed, reads the blocks
 * between its stored cursor and the chain head, and records every native-coin
 * and ERC-20 transfer that lands on a deposit address the exchange owns. Once a
 * deposit has the chain's required number of confirmations it is credited to the
 * user's ledger exactly once.
 *
 * It is deliberately pull-based and idempotent: the cursor is advanced in the
 * same step that the found deposits are recorded, a restart resumes from the
 * cursor rather than rescanning, and crediting is guarded by the deposit's own
 * status so a crash between "found" and "credited" cannot double-credit.
 *
 * Nothing is fabricated: a chain with no node configured is skipped and
 * reported, and a node that errors aborts that chain's scan rather than being
 * treated as "no deposits". The module is free of `next/server`.
 */

import { getDb, generateId } from '@/lib/db';
import { creditAvailable, debitAvailable, recordTransaction, LedgerError } from '@/lib/db/ledger';
import { recordDeposit as journalDeposit, reverseDeposit as journalReverseDeposit } from '@/lib/db/accounting';
import { placeWithdrawalHold } from '@/lib/security/freeze';
import { activeChains, listTokens, ChainRecord, TokenRecord } from '@/lib/chains/registry';
import {
  EvmRpcError,
  JsonRpcOptions,
  formatUnits,
  rpcBlockNumber,
  rpcGetLogs,
  rpcGetBlockByNumber,
  rpcTransactionReceipt,
  decodeTransferLog,
  ERC20_TRANSFER_TOPIC,
  isHexAddress,
} from '@/lib/chains/evm-rpc';

export interface ScannerOptions extends JsonRpcOptions {
  /** Hard cap on blocks examined in one call, so a long outage cannot hang. */
  batchBlocks?: number;
}

export interface ScanReport {
  chainKey: string;
  fromBlock: number;
  toBlock: number;
  found: number;
  /** Set when this chain could not be scanned; the cursor is left unchanged. */
  error?: string;
}

export interface ConfirmReport {
  credited: number;
  advanced: number;
}

function batchBlocks(): number {
  const configured = Number(process.env.TIGEREX_SCAN_BATCH_BLOCKS);
  if (Number.isInteger(configured) && configured > 0 && configured <= 5000) return configured;
  return 500;
}

/** The last block already processed for a chain, or null when unscanned. */
function readCursor(chainKey: string): number | null {
  const row = getDb()
    .prepare('SELECT last_scanned_block FROM chain_cursors WHERE chain_key = ?')
    .get(chainKey) as { last_scanned_block: number } | undefined;
  if (!row) return null;
  const value = Number(row.last_scanned_block);
  return Number.isFinite(value) ? value : null;
}

/** Persist the cursor. */
function writeCursor(chainKey: string, block: number): void {
  getDb()
    .prepare(
      `INSERT INTO chain_cursors (chain_key, last_scanned_block, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(chain_key) DO UPDATE SET last_scanned_block = excluded.last_scanned_block, updated_at = datetime('now')`,
    )
    .run(chainKey, Math.trunc(block));
}

/** Every deposit address the exchange owns on a chain, lower-cased. */
function ownedAddresses(chainKey: string): Map<string, { userId: string; walletId: string; asset: string }> {
  const rows = getDb()
    .prepare(
      `SELECT user_id, wallet_id, currency, address FROM wallets
        WHERE UPPER(network) = ? AND address IS NOT NULL AND address <> ''`,
    )
    .all(chainKey.toUpperCase()) as Array<{ user_id: string; wallet_id: string; currency: string; address: string }>;

  const map = new Map<string, { userId: string; walletId: string; asset: string }>();
  for (const row of rows) {
    map.set(row.address.toLowerCase(), {
      userId: row.user_id,
      walletId: row.wallet_id,
      asset: row.currency,
    });
  }
  return map;
}

/** Required confirmations for an asset/network, from the deposit-network listing. */
function requiredConfirmations(asset: string, network: string): number {
  const row = getDb()
    .prepare('SELECT confirmations FROM deposit_networks WHERE asset = ? AND UPPER(network) = ?')
    .get(asset, network.toUpperCase()) as { confirmations: number } | undefined;
  const value = Number(row?.confirmations);
  if (Number.isInteger(value) && value >= 0) return value;
  const fallback = Number(process.env.TIGEREX_DEFAULT_CONFIRMATIONS);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : 12;
}

/** Record a deposit once. Returns true when a new row was written. */
function recordDeposit(input: {
  userId: string;
  walletId: string;
  asset: string;
  network: string;
  amount: number;
  txHash: string;
  address: string;
  confirmations: number;
  required: number;
  blockNumber: number;
}): boolean {
  const db = getDb();
  if (input.amount <= 0) return false;

  const existing = db
    .prepare('SELECT deposit_id FROM deposits WHERE network = ? AND tx_hash = ? AND address = ?')
    .get(input.network, input.txHash, input.address) as { deposit_id: string } | undefined;
  if (existing) return false;

  db.prepare(
    `INSERT INTO deposits
       (deposit_id, user_id, wallet_id, currency, network, amount, tx_hash, address, confirmations, required_confirmations, block_number, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(
    generateId(),
    input.userId,
    input.walletId,
    input.asset,
    input.network,
    input.amount,
    input.txHash,
    input.address,
    input.confirmations,
    input.required,
    input.blockNumber,
  );
  return true;
}

/**
 * Scan one chain from its cursor to the head.
 *
 * Native transfers are found in each block's transaction list; ERC-20 transfers
 * are found in the block's `Transfer` logs. A block is only marked processed
 * after both have been read, so a failure part-way leaves the cursor behind and
 * the block is re-read next time.
 */
export async function scanChain(chain: ChainRecord, options: ScannerOptions = {}): Promise<ScanReport> {
  if (chain.chainType !== 'evm') {
    return { chainKey: chain.chainKey, fromBlock: 0, toBlock: 0, found: 0, error: 'chain is not EVM' };
  }

  const limit = options.batchBlocks ?? batchBlocks();
  const head = Number(await rpcBlockNumber(chain.rpcUrl, options));

  const cursor = readCursor(chain.chainKey);
  const configuredStart = Number(process.env[`TIGEREX_SCAN_START_BLOCK_${chain.chainKey.toUpperCase()}`]);
  const start = cursor === null
    ? (Number.isInteger(configuredStart) && configuredStart > 0 ? configuredStart : Math.max(0, head - limit))
    : cursor + 1;

  if (start > head) {
    return { chainKey: chain.chainKey, fromBlock: start, toBlock: head, found: 0 };
  }

  const toBlock = Math.min(head, start + limit - 1);
  const owned = ownedAddresses(chain.chainKey);
  const tokens = listTokens(chain.chainKey).filter((t) => t.status === 'active');
  const tokenByContract = new Map<string, TokenRecord>();
  for (const token of tokens) {
    if (token.contractAddress) tokenByContract.set(token.contractAddress.toLowerCase(), token);
  }

  let found = 0;

  // ERC-20 transfers, in one bounded `eth_getLogs` call.
  if (tokens.length > 0) {
    const logs = await rpcGetLogs(
      chain.rpcUrl,
      { fromBlock: BigInt(start), toBlock: BigInt(toBlock), topics: [ERC20_TRANSFER_TOPIC] },
      options,
    );
    for (const log of logs) {
      const token = tokenByContract.get(String(log.address).toLowerCase());
      if (!token) continue;
      const transfer = decodeTransferLog(log);
      if (!transfer) continue;
      const owner = owned.get(transfer.to.toLowerCase());
      if (!owner) continue;
      const asset = token.symbol.toUpperCase();
      found += recordDeposit({
        userId: owner.userId,
        walletId: owner.walletId,
        asset,
        network: chain.chainKey.toUpperCase(),
        amount: Number(formatUnits(transfer.value, token.decimals)),
        txHash: log.transactionHash,
        address: transfer.to.toLowerCase(),
        confirmations: Math.max(0, head - Number(BigInt(log.blockNumber)) + 1),
        required: requiredConfirmations(asset, chain.chainKey),
        blockNumber: Number(BigInt(log.blockNumber)),
      })
        ? 1
        : 0;
    }
  }

  // Native-coin transfers, read block by block.
  if (owned.size > 0) {
    for (let block = start; block <= toBlock; block += 1) {
      const payload = await rpcGetBlockByNumber(chain.rpcUrl, BigInt(block), options);
      if (!payload) continue;
      for (const tx of payload.transactions) {
        if (!tx.to) continue;
        const owner = owned.get(tx.to.toLowerCase());
        if (!owner) continue;
        const raw = BigInt(tx.value || '0x0');
        if (raw <= 0n) continue;
        const asset = owner.asset.toUpperCase();
        if (asset !== chain.nativeSymbol.toUpperCase()) {
          // A native transfer to an address labelled with another asset is not
          // credited: the label and the chain disagree, and guessing would risk
          // crediting the wrong asset.
          continue;
        }
        found += recordDeposit({
          userId: owner.userId,
          walletId: owner.walletId,
          asset,
          network: chain.chainKey.toUpperCase(),
          amount: Number(formatUnits(raw, chain.nativeDecimals)),
          txHash: tx.hash,
          address: tx.to.toLowerCase(),
          confirmations: Math.max(0, head - block + 1),
          required: requiredConfirmations(asset, chain.chainKey),
          blockNumber: block,
        })
          ? 1
          : 0;
      }
    }
  }

  writeCursor(chain.chainKey, toBlock);
  return { chainKey: chain.chainKey, fromBlock: start, toBlock, found };
}

/** Scan every active EVM chain, isolating a failing chain from the others. */
export async function scanAllChains(options: ScannerOptions = {}): Promise<ScanReport[]> {
  const reports: ScanReport[] = [];
  for (const chain of activeChains()) {
    if (chain.chainType !== 'evm') continue;
    try {
      reports.push(await scanChain(chain, options));
    } catch (error) {
      reports.push({
        chainKey: chain.chainKey,
        fromBlock: 0,
        toBlock: 0,
        found: 0,
        error: error instanceof EvmRpcError ? `${error.code}: ${error.message}` : String(error),
      });
    }
  }
  return reports;
}

/**
 * Advance pending deposits and credit the ones that have matured.
 *
 * A deposit is credited once: the status guard (`status = 'pending'`) is the
 * idempotency key, so re-running after a partial failure cannot credit twice.
 * Crediting runs in the caller's transaction via the ledger's own transaction.
 */
export async function confirmDeposits(options: JsonRpcOptions = {}): Promise<ConfirmReport> {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT d.deposit_id, d.user_id, d.currency, d.network, d.amount, d.tx_hash, d.address,
              d.confirmations, d.required_confirmations
         FROM deposits d
        WHERE d.status = 'pending' AND d.tx_hash IS NOT NULL
        ORDER BY d.created_at
        LIMIT 500`,
    )
    .all() as Array<{
    deposit_id: string;
    user_id: string;
    currency: string;
    network: string;
    amount: number;
    tx_hash: string;
    address: string;
    confirmations: number;
    required_confirmations: number;
  }>;

  let credited = 0;
  let advanced = 0;

  const chainCache = new Map<string, ChainRecord | null>();

  for (const deposit of pending) {
    const chainKey = deposit.network.toLowerCase();
    if (!chainCache.has(chainKey)) {
      chainCache.set(chainKey, activeChains().find((c) => c.chainKey === chainKey) ?? null);
    }
    const chain = chainCache.get(chainKey) ?? null;
    if (!chain) continue;

    let receipt: { status: string; blockNumber: string } | null;
    try {
      receipt = await rpcTransactionReceipt(chain.rpcUrl, deposit.tx_hash, options);
    } catch {
      continue;
    }
    if (!receipt) continue;

    const head = Number(await rpcBlockNumber(chain.rpcUrl, options));
    const confirmations = Math.max(0, head - Number(BigInt(receipt.blockNumber)) + 1);

    if (confirmations > Number(deposit.confirmations)) {
      db.prepare("UPDATE deposits SET confirmations = ? WHERE deposit_id = ?").run(
        confirmations,
        deposit.deposit_id,
      );
      advanced += 1;
    }

    if (receipt.status !== '0x1') {
      db.prepare("UPDATE deposits SET status = 'failed' WHERE deposit_id = ?").run(deposit.deposit_id);
      continue;
    }

    if (confirmations < Number(deposit.required_confirmations)) continue;

    const amount = Number(deposit.amount);
    // Claim, credit and stamp in one transaction so a crash cannot leave a
    // deposit claimed but uncredited (which would strand it) or credited but
    // still pending (which would credit it twice).
    db.transaction(() => {
      const claimed = db
        .prepare("UPDATE deposits SET status = 'crediting' WHERE deposit_id = ? AND status = 'pending'")
        .run(deposit.deposit_id);
      if (claimed.changes !== 1) return;

      creditAvailable(deposit.user_id, deposit.currency.toUpperCase(), amount, 'spot');
      journalDeposit(deposit.user_id, deposit.currency.toUpperCase(), amount, `On-chain deposit ${deposit.tx_hash}`);
      recordTransaction(
        deposit.user_id,
        'deposit',
        deposit.currency.toUpperCase(),
        amount,
        0,
        'completed',
        `On-chain deposit ${deposit.tx_hash}`,
      );
      db.prepare(
        "UPDATE deposits SET status = 'credited', credited_at = datetime('now'), block_number = ? WHERE deposit_id = ?",
      ).run(Number(BigInt(receipt.blockNumber)), deposit.deposit_id);
      credited += 1;
    })();
  }

  return { credited, advanced };
}

export interface ReorgReport {
  reversed: number;
  held: number;
}

/**
 * Reverse a credited deposit whose transaction is no longer on the canonical
 * chain.
 *
 * A deposit is credited once it has the required confirmations, but a chain
 * reorg can still orphan a transaction that deep, and then the exchange holds a
 * balance the chain never gave it. Every cycle re-validates the deposits
 * credited most recently: if the transaction has vanished from the node, or
 * sits at a block height that no longer matches, the credit is withdrawn.
 *
 * The reversal debits the user's available balance. When the funds have already
 * been spent the debit fails, the deposit is marked `reorged`, and a 48-hour
 * withdrawal hold is placed on the account so the shortfall is not compounded by
 * an immediate withdrawal. The deposit's status guard makes the reversal
 * idempotent, so a re-run cannot debit twice.
 */
export async function reverseReorgedDeposits(options: JsonRpcOptions = {}): Promise<ReorgReport> {
  const db = getDb();
  const limit = Number(process.env.TIGEREX_REORG_DEPTH);
  const depth = Number.isInteger(limit) && limit > 0 ? limit : 100;

  const credited = db
    .prepare(
      `SELECT deposit_id, user_id, currency, network, amount, tx_hash, address, block_number
         FROM deposits
        WHERE status = 'credited'
        ORDER BY credited_at DESC
        LIMIT ?`,
    )
    .all(depth) as Array<{
    deposit_id: string;
    user_id: string;
    currency: string;
    network: string;
    amount: number;
    tx_hash: string;
    address: string | null;
    block_number: number | null;
  }>;

  const chainCache = new Map<string, ChainRecord | null>();
  let reversed = 0;
  let held = 0;

  for (const deposit of credited) {
    const chainKey = deposit.network.toLowerCase();
    if (!chainCache.has(chainKey)) {
      chainCache.set(chainKey, activeChains().find((c) => c.chainKey === chainKey) ?? null);
    }
    const chain = chainCache.get(chainKey) ?? null;
    if (!chain) continue;

    let receipt: { status: string; blockNumber: string } | null;
    try {
      receipt = await rpcTransactionReceipt(chain.rpcUrl, deposit.tx_hash, options);
    } catch {
      // A node error is not evidence of a reorg; leave the credit in place.
      continue;
    }

    // Still present, and at the height it was credited from: not reorged. When
    // the receipt is gone, or the transaction moved to a different block, the
    // original credit is no longer backed by the canonical chain.
    const recorded = deposit.block_number === null ? null : Number(deposit.block_number);
    if (receipt && (recorded === null || Number(BigInt(receipt.blockNumber)) === recorded)) continue;

    const amount = Number(deposit.amount);
    const outcome = db.transaction((): 'reversed' | 'held' | 'skipped' => {
      const claimed = db
        .prepare("UPDATE deposits SET status = 'reorged' WHERE deposit_id = ? AND status = 'credited'")
        .run(deposit.deposit_id);
      if (claimed.changes !== 1) return 'skipped';

      try {
        debitAvailable(deposit.user_id, deposit.currency.toUpperCase(), amount, 'spot');
        journalReverseDeposit(deposit.user_id, deposit.currency.toUpperCase(), amount, `Deposit ${deposit.tx_hash} reorged out`);
        recordTransaction(
          deposit.user_id,
          'deposit',
          deposit.currency.toUpperCase(),
          amount,
          0,
          'failed',
          `Deposit ${deposit.tx_hash} reorged out of the chain`,
        );
        return 'reversed';
      } catch (error) {
        if (!(error instanceof LedgerError) || error.code !== 'INSUFFICIENT_BALANCE') throw error;
        // The user already spent the credit. Hold the account rather than let a
        // negative balance stand; the shortfall is a debt the operator pursues.
        db.prepare("UPDATE deposits SET status = 'reorg_shortfall' WHERE deposit_id = ?").run(
          deposit.deposit_id,
        );
        placeWithdrawalHold(deposit.user_id, 'Deposit reversed after a chain reorg; balance shortfall');
        return 'held';
      }
    })();

    if (outcome === 'reversed') reversed += 1;
    if (outcome === 'held') held += 1;
  }

  return { reversed, held };
}
