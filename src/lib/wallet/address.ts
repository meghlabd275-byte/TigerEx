/**
 * Blockchain address validation.
 *
 * A withdrawal must never be accepted for a malformed address: funds sent to a
 * typo are unrecoverable. This module therefore performs the real encoding
 * checks per chain rather than a regex approximation:
 *
 * - EVM chains use the EIP-55 checksum over Keccak-256.
 * - Bitcoin-style chains use Base58Check (double SHA-256) or Bech32/Bech32m.
 * - Solana uses a raw Base58 32-byte key.
 *
 * Every hash and checksum is computed here; nothing is delegated to a remote
 * service, and an unrecognised network is refused rather than assumed valid.
 */

import { createHash } from 'crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map<string, number>(
  BASE58_ALPHABET.split('').map((character, index) => [character, index]),
);

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_INDEX = new Map<string, number>(
  BECH32_CHARSET.split('').map((character, index) => [character, index]),
);
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

// ---------------------------------------------------------------------------
// Keccak-256 (Ethereum's hash; not SHA3-256, which uses a different padding)
// ---------------------------------------------------------------------------

const KECCAK_ROUNDS = 24;
const ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const MASK64 = (1n << 64n) - 1n;

function rotateLeft(value: bigint, shift: number): bigint {
  if (shift === 0) return value & MASK64;
  const amount = BigInt(shift);
  return ((value << amount) | (value >> (64n - amount))) & MASK64;
}

function keccakF(state: bigint[][]): void {
  for (let round = 0; round < KECCAK_ROUNDS; round += 1) {
    // Theta
    const column = new Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      column[x] = state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = column[(x + 4) % 5] ^ rotateLeft(column[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x][y] ^= d;
    }

    // Rho and Pi
    const moved: bigint[][] = [
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n],
    ];
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        moved[y][(2 * x + 3 * y) % 5] = rotateLeft(state[x][y], ROTATION[x][y]);
      }
    }

    // Chi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x][y] = moved[x][y] ^ (~moved[(x + 1) % 5][y] & MASK64 & moved[(x + 2) % 5][y]);
      }
    }

    // Iota
    state[0][0] ^= ROUND_CONSTANTS[round];
  }
}

/** Keccak-256 digest as a lowercase hex string. */
export function keccak256Hex(input: Uint8Array | string): string {
  const message = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  const rate = 136; // 1088 bits
  const padded = Buffer.alloc(Math.ceil((message.length + 1) / rate) * rate);
  message.copy(padded);
  padded[message.length] = 0x01; // Keccak padding
  padded[padded.length - 1] |= 0x80;

  const state: bigint[][] = [];
  for (let x = 0; x < 5; x += 1) state.push(new Array<bigint>(5).fill(0n));

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      const x = lane % 5;
      const y = Math.floor(lane / 5);
      state[x][y] ^= padded.readBigUInt64LE(offset + lane * 8);
    }
    keccakF(state);
  }

  const digest = Buffer.alloc(32);
  for (let lane = 0; lane < 4; lane += 1) {
    const x = lane % 5;
    const y = Math.floor(lane / 5);
    digest.writeBigUInt64LE(state[x][y], lane * 8);
  }
  return digest.toString('hex');
}

// ---------------------------------------------------------------------------
// Base58 and Base58Check
// ---------------------------------------------------------------------------

function base58Decode(value: string): Buffer | null {
  if (value.length === 0) return null;
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return null;
    number = number * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== '1') break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

function base58Encode(bytes: Uint8Array): string {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);

  let encoded = '';
  while (number > 0n) {
    encoded = BASE58_ALPHABET[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }
  return encoded;
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

function doubleSha256(bytes: Uint8Array): Buffer {
  return sha256(sha256(bytes));
}

/** Decode Base58Check, verifying the 4-byte double-SHA-256 checksum. */
export function base58CheckDecode(value: string): Buffer | null {
  const decoded = base58Decode(value);
  if (!decoded || decoded.length < 5) return null;
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expected = doubleSha256(payload).subarray(0, 4);
  return checksum.equals(expected) ? payload : null;
}

/** Encode a payload with a Base58Check checksum. */
export function base58CheckEncode(payload: Uint8Array): string {
  const checksum = doubleSha256(payload).subarray(0, 4);
  return base58Encode(Buffer.concat([Buffer.from(payload), checksum]));
}

// ---------------------------------------------------------------------------
// Bech32 / Bech32m (BIP-173 / BIP-350)
// ---------------------------------------------------------------------------

function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) checksum ^= generators[i];
    }
  }
  return checksum;
}

function bech32HrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (const character of hrp) expanded.push(character.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const character of hrp) expanded.push(character.charCodeAt(0) & 31);
  return expanded;
}

interface Bech32Decoded {
  hrp: string;
  version: number;
  program: Buffer;
  encoding: 'bech32' | 'bech32m';
}

/** Decode a Bech32/Bech32m segwit address, verifying its checksum. */
export function bech32Decode(address: string): Bech32Decoded | null {
  if (address.length < 8 || address.length > 90) return null;
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return null;

  const normalized = address.toLowerCase();
  const separator = normalized.lastIndexOf('1');
  if (separator < 1 || separator + 7 > normalized.length) return null;

  const hrp = normalized.slice(0, separator);
  const data: number[] = [];
  for (const character of normalized.slice(separator + 1)) {
    const value = BECH32_INDEX.get(character);
    if (value === undefined) return null;
    data.push(value);
  }

  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  const encoding = polymod === BECH32_CONST ? 'bech32' : polymod === BECH32M_CONST ? 'bech32m' : null;
  if (encoding === null) return null;

  const payload = data.slice(0, -6);
  if (payload.length === 0) return null;
  const version = payload[0];
  if (version > 16) return null;

  // Convert the 5-bit groups to 8-bit bytes, rejecting invalid padding.
  const words = payload.slice(1);
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const word of words) {
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return null;

  const program = Buffer.from(bytes);
  if (program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  // Version 0 uses the original Bech32 checksum; versions 1+ use Bech32m.
  if (version === 0 && encoding !== 'bech32') return null;
  if (version !== 0 && encoding !== 'bech32m') return null;

  return { hrp, version, program, encoding };
}

// ---------------------------------------------------------------------------
// EVM addresses
// ---------------------------------------------------------------------------

/** Whether an EVM address carries a valid EIP-55 checksum (or no case at all). */
export function isEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;

  const hash = keccak256Hex(body.toLowerCase());
  for (let i = 0; i < 40; i += 1) {
    const character = body[i];
    if (/[0-9]/.test(character)) continue;
    const nibble = parseInt(hash[i], 16);
    if (nibble >= 8 && character !== character.toUpperCase()) return false;
    if (nibble < 8 && character !== character.toLowerCase()) return false;
  }
  return true;
}

/** The EIP-55 checksummed form of an EVM address, or null when malformed. */
export function toChecksumAddress(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const body = address.slice(2).toLowerCase();
  const hash = keccak256Hex(body);
  let checksummed = '0x';
  for (let i = 0; i < 40; i += 1) {
    checksummed += parseInt(hash[i], 16) >= 8 ? body[i].toUpperCase() : body[i];
  }
  return checksummed;
}

// ---------------------------------------------------------------------------
// Per-network validation
// ---------------------------------------------------------------------------

const EVM_NETWORKS = new Set([
  'ERC20', 'ETH', 'ETHEREUM', 'BEP20', 'BSC', 'BNB', 'POLYGON', 'MATIC', 'AVALANCHE',
  'AVAXC', 'ARBITRUM', 'OPTIMISM', 'BASE', 'LINEA', 'SCROLL', 'ZKSYNC', 'MANTLE',
  'BLAST', 'CELO', 'FTM', 'FANTOM', 'GNOSIS', 'KAVA', 'AURORA', 'CRONOS', 'OKC',
  'HECO', 'EVM',
]);

const BITCOIN_LIKE: Record<string, { p2pkh: number[]; p2sh: number[]; hrp: string[] }> = {
  BTC: { p2pkh: [0x00], p2sh: [0x05], hrp: ['bc'] },
  LTC: { p2pkh: [0x30], p2sh: [0x32], hrp: ['ltc'] },
  DOGE: { p2pkh: [0x1e], p2sh: [0x16], hrp: [] },
  BCH: { p2pkh: [0x00], p2sh: [0x05], hrp: [] },
  DASH: { p2pkh: [0x4c], p2sh: [0x10], hrp: [] },
  ZEC: { p2pkh: [0x1cb8], p2sh: [0x1cbd], hrp: [] },
};

const RAW_BASE58_NETWORKS = new Set(['SOL', 'SOLANA']);

const COSMOS_HRP: Record<string, string> = {
  ATOM: 'cosmos',
  OSMO: 'osmo',
  INJ: 'inj',
  SEI: 'sei',
  CRO: 'cro',
  KAVA_COSMOS: 'kava',
  TERRA: 'terra',
};

export interface AddressValidation {
  valid: boolean;
  /** Canonical form to store, when the input was well formed. */
  normalized: string | null;
  reason: string | null;
}

function invalid(reason: string): AddressValidation {
  return { valid: false, normalized: null, reason };
}

/**
 * Validate an address for a network.
 *
 * An unknown network is refused: accepting an address the exchange cannot check
 * would let a user send funds to an address that does not exist on that chain.
 */
export function validateAddress(network: string, address: string): AddressValidation {
  const chain = String(network ?? '').trim().toUpperCase();
  const value = String(address ?? '').trim();

  if (value.length === 0 || value.length > 128) return invalid('Address is empty or too long');
  if (/\s/.test(value)) return invalid('Address must not contain whitespace');

  if (EVM_NETWORKS.has(chain)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      return invalid(`${chain} addresses are 20 bytes, written as 0x followed by 40 hex characters`);
    }
    if (!isEvmAddress(value)) return invalid('The address checksum is invalid; it may contain a typo');
    return { valid: true, normalized: toChecksumAddress(value), reason: null };
  }

  if (chain === 'TRON' || chain === 'TRC20') {
    const payload = base58CheckDecode(value);
    if (!payload || payload.length !== 21 || payload[0] !== 0x41) {
      return invalid('A TRON address is a Base58Check encoding of a 21-byte payload beginning with 0x41');
    }
    return { valid: true, normalized: value, reason: null };
  }

  if (RAW_BASE58_NETWORKS.has(chain)) {
    const decoded = base58Decode(value);
    if (!decoded || decoded.length !== 32) {
      return invalid('A Solana address is a Base58 encoding of a 32-byte public key');
    }
    return { valid: true, normalized: value, reason: null };
  }

  const bitcoinLike = BITCOIN_LIKE[chain];
  if (bitcoinLike) {
    const payload = base58CheckDecode(value);
    if (payload && payload.length === 21) {
      const version = payload[0] === 0x1c ? (payload[0] << 8) | payload[1] : payload[0];
      const recognized = bitcoinLike.p2pkh.includes(version) || bitcoinLike.p2sh.includes(version);
      if (!recognized) return invalid(`The ${chain} version byte does not match this network`);
      return { valid: true, normalized: value, reason: null };
    }

    const segwit = bech32Decode(value);
    if (segwit && bitcoinLike.hrp.includes(segwit.hrp)) {
      return { valid: true, normalized: value.toLowerCase(), reason: null };
    }

    return invalid(`Not a valid ${chain} address`);
  }

  if (chain === 'XRP') {
    const payload = base58CheckDecode(value);
    // An XRP account id is a 20-byte hash plus a 1-byte type prefix.
    if (!payload || payload.length !== 21 || payload[0] !== 0x00) {
      return invalid('An XRP address is a Base58Check encoding of a 21-byte account id');
    }
    return { valid: true, normalized: value, reason: null };
  }

  if (COSMOS_HRP[chain]) {
    const decoded = bech32Decode(value);
    if (!decoded || decoded.hrp !== COSMOS_HRP[chain] || decoded.program.length !== 20) {
      return invalid(`A ${chain} address is Bech32 with the ${COSMOS_HRP[chain]} prefix and a 20-byte key`);
    }
    return { valid: true, normalized: value.toLowerCase(), reason: null };
  }

  return invalid(`Address validation is not supported for ${chain || 'this network'}`);
}

/** Networks the exchange can validate, for the deposit/withdrawal UI. */
export const VALIDATABLE_NETWORKS: string[] = [
  ...EVM_NETWORKS,
  'TRON',
  'TRC20',
  ...RAW_BASE58_NETWORKS,
  ...Object.keys(BITCOIN_LIKE),
  'XRP',
  ...Object.keys(COSMOS_HRP),
].sort();
