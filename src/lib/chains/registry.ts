/**
 * Blockchain and token registry.
 *
 * Which chains the exchange serves, and the tokens on them, is operator
 * configuration stored in `blockchain_chains` and `blockchain_tokens` — never a
 * list compiled into the code. A chain row carries the node URL the balance
 * reader dials and the chain id that node must report; a token row carries the
 * contract address and decimals a balance read needs.
 *
 * Nothing here is seeded: a fresh deployment serves no chain until an
 * administrator lists one, and a token cannot be listed on a chain that is not
 * listed itself. That keeps the wallet view and the on-chain reader in
 * agreement, and stops the exchange from inventing an address or a balance on a
 * chain it does not operate.
 *
 * Kept free of `next/server` so the validation can be unit tested.
 */

import { getDb, generateId } from '@/lib/db';
import { isHexAddress } from '@/lib/chains/evm-rpc';

export class ChainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'ChainError';
  }
}

export type ChainType = 'evm' | 'non-evm';

export interface ChainRecord {
  chainKey: string;
  name: string;
  chainType: ChainType;
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerUrl: string;
  status: string;
}

export interface TokenRecord {
  tokenId: string;
  chainKey: string;
  symbol: string;
  name: string;
  contractAddress: string | null;
  decimals: number;
  status: string;
}

const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const SYMBOL_RE = /^[A-Z0-9]{1,20}$/;
const STATUSES = ['active', 'paused', 'delisting'];
const CHAIN_TYPES: ChainType[] = ['evm', 'non-evm'];

/**
 * Validate an RPC endpoint.
 *
 * The URL must be absolute; `https://` is required, with a plaintext `http://`
 * origin allowed only outside production so a local node can be reached. A URL
 * carrying userinfo is refused, so a credential cannot be smuggled through
 * configuration and later logged.
 */
export function validateRpcUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production') return parsed.toString();
  return null;
}

/** Validate an explorer base URL; optional, but must be absolute when present. */
function validateExplorerUrl(raw: unknown): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return '';
  let parsed: URL;
  try {
    parsed = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production')) {
    return parsed.toString().replace(/\/$/, '');
  }
  return null;
}

export type ChainValidation = { chain: ChainRecord } | { error: string };

export function validateChainInput(body: Record<string, unknown>): ChainValidation {
  const chainKey = String(body.chainKey ?? body.chain_key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(chainKey)) {
    return { error: 'chainKey must be 1-40 lowercase letters, digits, dash or underscore' };
  }

  const name = String(body.name ?? '').trim();
  if (name.length === 0 || name.length > 80) return { error: 'name is required and at most 80 characters' };

  const chainType = String(body.chainType ?? body.chain_type ?? 'evm').trim().toLowerCase() as ChainType;
  if (!CHAIN_TYPES.includes(chainType)) return { error: 'chainType must be evm or non-evm' };

  const chainId = Number(body.chainId ?? body.chain_id);
  if (!Number.isInteger(chainId) || chainId < 0 || chainId > Number.MAX_SAFE_INTEGER) {
    return { error: 'chainId must be a non-negative integer' };
  }

  const nativeSymbol = String(body.nativeSymbol ?? body.native_symbol ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(nativeSymbol)) {
    return { error: 'nativeSymbol must be 1-20 uppercase letters or digits' };
  }

  const nativeDecimals = Number(body.nativeDecimals ?? body.native_decimals ?? 18);
  if (!Number.isInteger(nativeDecimals) || nativeDecimals < 0 || nativeDecimals > 255) {
    return { error: 'nativeDecimals must be an integer between 0 and 255' };
  }

  const rpcUrl = validateRpcUrl(body.rpcUrl ?? body.rpc_url);
  if (!rpcUrl) {
    return { error: 'rpcUrl must be an absolute https URL (http is allowed only outside production)' };
  }

  const explorerUrl = validateExplorerUrl(body.explorerUrl ?? body.explorer_url);
  if (explorerUrl === null) {
    return { error: 'explorerUrl must be an absolute https URL when provided' };
  }

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!STATUSES.includes(status)) return { error: 'status must be one of active, paused, delisting' };

  return {
    chain: { chainKey, name, chainType, chainId, nativeSymbol, nativeDecimals, rpcUrl, explorerUrl, status },
  };
}

function toChain(row: Record<string, unknown>): ChainRecord {
  return {
    chainKey: String(row.chain_key),
    name: String(row.name),
    chainType: String(row.chain_type) as ChainType,
    chainId: Number(row.chain_id) || 0,
    nativeSymbol: String(row.native_symbol),
    nativeDecimals: Number(row.native_decimals) || 0,
    rpcUrl: String(row.rpc_url),
    explorerUrl: String(row.explorer_url ?? ''),
    status: String(row.status ?? 'active'),
  };
}

/** Every listed chain, active first then by key. */
export function listChains(options: { status?: string } = {}): ChainRecord[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status.trim().toLowerCase());
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM blockchain_chains${where} ORDER BY chain_key`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(toChain);
}

/** The active chains the wallet view offers. */
export function activeChains(): ChainRecord[] {
  return listChains({ status: 'active' });
}

/** A single chain, or null. */
export function getChain(chainKey: string): ChainRecord | null {
  const key = String(chainKey ?? '').trim().toLowerCase();
  if (!key) return null;
  const row = getDb()
    .prepare('SELECT * FROM blockchain_chains WHERE chain_key = ?')
    .get(key) as Record<string, unknown> | undefined;
  return row ? toChain(row) : null;
}

/** Add or update a chain. Returns the stored row. */
export function upsertChain(body: Record<string, unknown>): ChainRecord {
  const validated = validateChainInput(body);
  if ('error' in validated) throw new ChainError('VALIDATION_FAILED', validated.error);
  const { chain } = validated;

  const db = getDb();
  const existing = db
    .prepare('SELECT chain_key FROM blockchain_chains WHERE chain_key = ?')
    .get(chain.chainKey) as { chain_key: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE blockchain_chains
          SET name = ?, chain_type = ?, chain_id = ?, native_symbol = ?, native_decimals = ?,
              rpc_url = ?, explorer_url = ?, status = ?, updated_at = datetime('now')
        WHERE chain_key = ?`,
    ).run(
      chain.name,
      chain.chainType,
      chain.chainId,
      chain.nativeSymbol,
      chain.nativeDecimals,
      chain.rpcUrl,
      chain.explorerUrl,
      chain.status,
      chain.chainKey,
    );
  } else {
    db.prepare(
      `INSERT INTO blockchain_chains
         (chain_key, name, chain_type, chain_id, native_symbol, native_decimals, rpc_url, explorer_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      chain.chainKey,
      chain.name,
      chain.chainType,
      chain.chainId,
      chain.nativeSymbol,
      chain.nativeDecimals,
      chain.rpcUrl,
      chain.explorerUrl,
      chain.status,
    );
  }

  return chain;
}

/**
 * Remove a chain.
 *
 * Refused while any token is still listed on it, or any wallet holds an address
 * there: either would leave a dangling reference, so the operator must pause it
 * instead.
 */
export function removeChain(chainKey: string): void {
  const key = String(chainKey ?? '').trim().toLowerCase();
  const db = getDb();
  const row = db.prepare('SELECT chain_key FROM blockchain_chains WHERE chain_key = ?').get(key) as
    | { chain_key: string }
    | undefined;
  if (!row) throw new ChainError('NOT_FOUND', 'That chain is not listed', 404);

  const tokens = db
    .prepare('SELECT COUNT(*) AS n FROM blockchain_tokens WHERE chain_key = ?')
    .get(key) as { n: number };
  if (tokens.n > 0) {
    throw new ChainError('CHAIN_IN_USE', 'Tokens are still listed on this chain; remove them first', 409);
  }

  const wallets = db
    .prepare("SELECT COUNT(*) AS n FROM wallets WHERE UPPER(network) = ? AND address IS NOT NULL AND address <> ''")
    .get(key.toUpperCase()) as { n: number };
  if (wallets.n > 0) {
    throw new ChainError('CHAIN_IN_USE', 'Deposit addresses already exist on this chain; pause it instead', 409);
  }

  db.prepare('DELETE FROM blockchain_chains WHERE chain_key = ?').run(key);
}

export type TokenValidation = { token: TokenRecord } | { error: string };

export function validateTokenInput(body: Record<string, unknown>): TokenValidation {
  const chainKey = String(body.chainKey ?? body.chain_key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(chainKey)) {
    return { error: 'chainKey must be 1-40 lowercase letters, digits, dash or underscore' };
  }

  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return { error: 'symbol must be 1-20 uppercase letters or digits' };

  const name = String(body.name ?? '').trim();
  if (name.length === 0 || name.length > 80) return { error: 'name is required and at most 80 characters' };

  const chain = getChain(chainKey);
  if (!chain) return { error: `chain ${chainKey} is not listed` };

  const decimals = Number(body.decimals ?? 18);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return { error: 'decimals must be an integer between 0 and 255' };
  }

  const rawAddress = body.contractAddress ?? body.contract_address;
  let contractAddress: string | null = null;
  if (rawAddress !== undefined && rawAddress !== null && String(rawAddress).trim() !== '') {
    const value = String(rawAddress).trim();
    if (!isHexAddress(value)) return { error: 'contractAddress must be a 0x-prefixed 20-byte address' };
    contractAddress = value;
  }

  // An EVM chain's non-native token is only readable through a contract
  // address; without one a balance read would silently return zero.
  if (chain.chainType === 'evm' && symbol !== chain.nativeSymbol && contractAddress === null) {
    return { error: `a contractAddress is required for ${symbol} on ${chainKey}` };
  }

  const status = String(body.status ?? 'active').trim().toLowerCase();
  if (!STATUSES.includes(status)) return { error: 'status must be one of active, paused, delisting' };

  return {
    token: {
      tokenId: String(body.tokenId ?? ''),
      chainKey,
      symbol,
      name,
      contractAddress,
      decimals,
      status,
    },
  };
}

function toToken(row: Record<string, unknown>): TokenRecord {
  return {
    tokenId: String(row.token_id),
    chainKey: String(row.chain_key),
    symbol: String(row.symbol),
    name: String(row.name),
    contractAddress: row.contract_address === null || row.contract_address === undefined
      ? null
      : String(row.contract_address),
    decimals: Number(row.decimals) || 0,
    status: String(row.status ?? 'active'),
  };
}

/** The tokens listed on a chain. */
export function listTokens(chainKey?: string): TokenRecord[] {
  const db = getDb();
  if (chainKey) {
    const key = String(chainKey).trim().toLowerCase();
    const rows = db
      .prepare('SELECT * FROM blockchain_tokens WHERE chain_key = ? ORDER BY symbol')
      .all(key) as Array<Record<string, unknown>>;
    return rows.map(toToken);
  }
  const rows = db.prepare('SELECT * FROM blockchain_tokens ORDER BY chain_key, symbol').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(toToken);
}

/** The active tokens listed on a chain. */
export function activeTokens(chainKey: string): TokenRecord[] {
  const key = String(chainKey ?? '').trim().toLowerCase();
  const rows = getDb()
    .prepare("SELECT * FROM blockchain_tokens WHERE chain_key = ? AND status = 'active' ORDER BY symbol")
    .all(key) as Array<Record<string, unknown>>;
  return rows.map(toToken);
}

/** Add or update a token listing. Returns the stored row. */
export function upsertToken(body: Record<string, unknown>): TokenRecord {
  const validated = validateTokenInput(body);
  if ('error' in validated) throw new ChainError('VALIDATION_FAILED', validated.error);
  const { token } = validated;

  const db = getDb();
  const existing = db
    .prepare('SELECT token_id FROM blockchain_tokens WHERE chain_key = ? AND symbol = ?')
    .get(token.chainKey, token.symbol) as { token_id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE blockchain_tokens
          SET name = ?, contract_address = ?, decimals = ?, status = ?, updated_at = datetime('now')
        WHERE token_id = ?`,
    ).run(token.name, token.contractAddress, token.decimals, token.status, existing.token_id);
    token.tokenId = existing.token_id;
  } else {
    const tokenId = generateId();
    db.prepare(
      `INSERT INTO blockchain_tokens
         (token_id, chain_key, symbol, name, contract_address, decimals, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(tokenId, token.chainKey, token.symbol, token.name, token.contractAddress, token.decimals, token.status);
    token.tokenId = tokenId;
  }

  return token;
}

/** Remove a token listing by its id. */
export function removeTokenById(tokenId: string): TokenRecord {
  const id = String(tokenId ?? '').trim();
  const db = getDb();
  const row = db.prepare('SELECT * FROM blockchain_tokens WHERE token_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new ChainError('NOT_FOUND', 'That token is not listed', 404);
  db.prepare('DELETE FROM blockchain_tokens WHERE token_id = ?').run(id);
  return toToken(row);
}

/** Remove a token listing by chain and symbol. */
export function removeToken(chainKey: string, symbol: string): void {
  const key = String(chainKey ?? '').trim().toLowerCase();
  const upperSymbol = String(symbol ?? '').trim().toUpperCase();
  const db = getDb();
  const row = db
    .prepare('SELECT token_id FROM blockchain_tokens WHERE chain_key = ? AND symbol = ?')
    .get(key, upperSymbol) as { token_id: string } | undefined;
  if (!row) throw new ChainError('NOT_FOUND', 'That token is not listed on this chain', 404);
  db.prepare('DELETE FROM blockchain_tokens WHERE token_id = ?').run(row.token_id);
}
