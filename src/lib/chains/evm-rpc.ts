/**
 * Minimal EVM JSON-RPC client and ABI codec.
 *
 * The exchange reads balances straight from the chain's own node rather than
 * from an indexer or a third-party API, so the values shown to a user are the
 * chain's, not a mirror of someone else's database. Only the handful of methods
 * needed for balances and metadata are implemented; anything else is refused.
 *
 * Nothing here caches: a balance is fetched per request with `cache: 'no-store'`
 * and a bounded timeout, and every failure surfaces as an `EvmRpcError` rather
 * than a zero balance, because a fabricated zero would look like an empty
 * account.
 *
 * Kept free of `next/server` so the codec and the request builder can be
 * exercised directly by the logic test runner.
 */

export class EvmRpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'EvmRpcError';
  }
}

/** ERC-20 function selectors (first four bytes of keccak256 of the signature). */
export const ERC20_SELECTORS = {
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
  totalSupply: '0x18160ddd',
} as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Whether a string is a syntactically valid 20-byte EVM address. */
export function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}

/** Parse a JSON-RPC hex quantity such as `0x1b4` into a bigint, or null. */
export function hexToBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/** Encode a bigint as a minimal JSON-RPC hex quantity. */
export function toHexQuantity(value: bigint): string {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new EvmRpcError('INVALID_QUANTITY', 'A non-negative integer is required', 400);
  }
  return `0x${value.toString(16)}`;
}

/** Left-pad an address to a 32-byte ABI word (no `0x`). */
export function encodeAddressWord(address: string): string {
  if (!isHexAddress(address)) {
    throw new EvmRpcError('INVALID_ADDRESS', 'A 0x-prefixed 20-byte address is required', 400);
  }
  return address.slice(2).toLowerCase().padStart(64, '0');
}

/** The `balanceOf(address)` call data for an ERC-20 balance read. */
export function encodeBalanceOf(address: string): string {
  return `${ERC20_SELECTORS.balanceOf}${encodeAddressWord(address)}`;
}

/** Decode a single 32-byte ABI word as an unsigned integer, or null. */
export function decodeUint256(hex: unknown): bigint | null {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  const body = hex.slice(2);
  if (body.length === 0 || body.length > 64) return null;
  try {
    return BigInt(`0x${body}`);
  } catch {
    return null;
  }
}

/** Decode a 32-byte word as an unsigned integer no larger than a JS safe integer. */
export function decodeUint8(hex: unknown): number | null {
  const value = decodeUint256(hex);
  if (value === null || value > 255n) return null;
  return Number(value);
}

/**
 * Decode an ABI-encoded `string` return value.
 *
 * The canonical encoding is `offset (32) || length (32) || data`, padded to a
 * multiple of 32 bytes. Some legacy tokens return a `bytes32` instead; that
 * shape is read back by trimming trailing zero bytes so a `symbol()` call does
 * not fail against them.
 */
export function decodeAbiString(hex: unknown): string | null {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  const body = hex.slice(2);
  if (body.length === 0) return null;

  if (body.length === 64) {
    // A bytes32 string with trailing zero padding.
    const trimmed = body.replace(/(00)+$/, '');
    if (trimmed.length === 0) return null;
    return hexToUtf8(trimmed);
  }

  if (body.length < 128) return null;
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const lengthHex = body.slice(offset * 2, offset * 2 + 64);
  if (lengthHex.length !== 64) return null;
  const length = Number(BigInt(`0x${lengthHex}`));
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const dataHex = body.slice(offset * 2 + 64, offset * 2 + 64 + length * 2);
  if (dataHex.length !== length * 2) return null;
  return hexToUtf8(dataHex);
}

function hexToUtf8(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  try {
    const bytes = Buffer.from(hex, 'hex');
    const text = bytes.toString('utf8');
    // Reject control characters so a malformed word is not shown as a symbol.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Format a base-unit integer amount as a decimal string.
 *
 * Done with integer arithmetic so a large balance does not lose precision the
 * way `Number(value) / 10 ** decimals` would.
 */
export function formatUnits(value: bigint, decimals: number): string {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new EvmRpcError('INVALID_AMOUNT', 'A non-negative integer amount is required', 400);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new EvmRpcError('INVALID_DECIMALS', 'decimals must be an integer between 0 and 255', 400);
  }
  if (decimals === 0) return value.toString();

  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export interface JsonRpcOptions {
  /** Abort the request after this many milliseconds. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Perform a JSON-RPC call.
 *
 * Fails closed on a non-2xx status, a non-JSON body, a JSON-RPC `error` member,
 * a missing `result`, or a timeout. The response is never cached.
 */
export async function jsonRpc(
  url: string,
  method: string,
  params: unknown[],
  options: JsonRpcOptions = {},
): Promise<unknown> {
  const endpoint = requireRpcUrl(url);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new EvmRpcError(
      aborted ? 'RPC_TIMEOUT' : 'RPC_UNREACHABLE',
      aborted ? 'The chain node did not respond in time' : 'The chain node could not be reached',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new EvmRpcError('RPC_HTTP_ERROR', `The chain node returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EvmRpcError('RPC_INVALID_RESPONSE', 'The chain node returned a non-JSON body');
  }

  if (!payload || typeof payload !== 'object') {
    throw new EvmRpcError('RPC_INVALID_RESPONSE', 'The chain node returned an empty body');
  }
  const body = payload as { error?: unknown; result?: unknown };
  if (body.error) {
    const detail = typeof body.error === 'object' && body.error !== null
      ? String((body.error as { message?: unknown }).message ?? 'unknown error')
      : String(body.error);
    throw new EvmRpcError('RPC_ERROR', `The chain node rejected the request: ${detail}`);
  }
  if (body.result === undefined) {
    throw new EvmRpcError('RPC_INVALID_RESPONSE', 'The chain node returned no result');
  }
  return body.result;
}

/**
 * Validate an RPC endpoint.
 *
 * Only `https://` origins are accepted; a plaintext `http://` origin is allowed
 * solely outside production for a local node. A URL carrying credentials is
 * refused so a secret cannot be smuggled in through configuration.
 */
export function requireRpcUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new EvmRpcError('RPC_NOT_CONFIGURED', 'No chain node URL is configured', 503);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new EvmRpcError('RPC_NOT_CONFIGURED', 'The chain node URL is not a valid URL', 503);
  }
  if (parsed.username || parsed.password) {
    throw new EvmRpcError('RPC_NOT_CONFIGURED', 'The chain node URL must not carry credentials', 503);
  }
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production') return parsed.toString();
  throw new EvmRpcError('RPC_NOT_CONFIGURED', 'The chain node URL must use https', 503);
}

/** `eth_chainId` as a bigint. */
export async function rpcChainId(url: string, options?: JsonRpcOptions): Promise<bigint> {
  const value = hexToBigInt(await jsonRpc(url, 'eth_chainId', [], options));
  if (value === null) throw new EvmRpcError('RPC_INVALID_RESPONSE', 'eth_chainId returned an invalid value');
  return value;
}

/** `eth_blockNumber` as a bigint. */
export async function rpcBlockNumber(url: string, options?: JsonRpcOptions): Promise<bigint> {
  const value = hexToBigInt(await jsonRpc(url, 'eth_blockNumber', [], options));
  if (value === null) throw new EvmRpcError('RPC_INVALID_RESPONSE', 'eth_blockNumber returned an invalid value');
  return value;
}

/** The native-coin balance of an address, in base units. */
export async function rpcNativeBalance(
  url: string,
  address: string,
  options?: JsonRpcOptions,
): Promise<bigint> {
  if (!isHexAddress(address)) {
    throw new EvmRpcError('INVALID_ADDRESS', 'A 0x-prefixed 20-byte address is required', 400);
  }
  const value = hexToBigInt(await jsonRpc(url, 'eth_getBalance', [address, 'latest'], options));
  if (value === null) throw new EvmRpcError('RPC_INVALID_RESPONSE', 'eth_getBalance returned an invalid value');
  return value;
}

/** The ERC-20 balance of an address, in the token's base units. */
export async function rpcErc20Balance(
  url: string,
  token: string,
  address: string,
  options?: JsonRpcOptions,
): Promise<bigint> {
  if (!isHexAddress(token)) {
    throw new EvmRpcError('INVALID_TOKEN', 'The token contract address is not a valid address', 400);
  }
  const data = encodeBalanceOf(address);
  const result = await jsonRpc(url, 'eth_call', [{ to: token, data }, 'latest'], options);
  const value = decodeUint256(result);
  if (value === null) throw new EvmRpcError('RPC_INVALID_RESPONSE', 'balanceOf returned an invalid value');
  return value;
}

/** Read an ERC-20 token's `symbol` and `decimals`. */
export async function rpcErc20Metadata(
  url: string,
  token: string,
  options?: JsonRpcOptions,
): Promise<{ symbol: string | null; decimals: number | null }> {
  if (!isHexAddress(token)) {
    throw new EvmRpcError('INVALID_TOKEN', 'The token contract address is not a valid address', 400);
  }
  const [symbolRaw, decimalsRaw] = await Promise.all([
    jsonRpc(url, 'eth_call', [{ to: token, data: ERC20_SELECTORS.symbol }, 'latest'], options),
    jsonRpc(url, 'eth_call', [{ to: token, data: ERC20_SELECTORS.decimals }, 'latest'], options),
  ]);
  return { symbol: decodeAbiString(symbolRaw), decimals: decodeUint8(decimalsRaw) };
}
