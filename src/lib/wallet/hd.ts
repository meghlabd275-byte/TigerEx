/**
 * Hierarchical deterministic key derivation (BIP-39 seed, BIP-32 child keys).
 *
 * The exchange derives each user's deposit address itself from the custody
 * master seed rather than asking an external service, so the private key never
 * leaves the process. This module implements the standards directly:
 *
 * - BIP-39: the seed is PBKDF2-HMAC-SHA512 over the mnemonic, 2048 rounds.
 * - BIP-32: child keys are derived with HMAC-SHA512 and secp256k1 addition.
 * - EIP-55: the address is Keccak-256 of the uncompressed public key.
 *
 * No secret is logged or returned: only the public address leaves this module.
 */

import { createHmac, pbkdf2Sync } from 'crypto';
import { keccak256Hex, toChecksumAddress } from '@/lib/wallet/address';
import { isEvmChainNetwork } from '@/lib/chains/chain-networks';

// secp256k1 domain parameters.
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const HARDENED = 0x80000000;

function mod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

function modInverse(value: bigint, modulus: bigint): bigint {
  let [old_r, r] = [mod(value, modulus), modulus];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  return mod(old_s, modulus);
}

interface Point {
  x: bigint;
  y: bigint;
}

function pointAdd(a: Point | null, b: Point | null): Point | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x && mod(a.y + b.y, P) === 0n) return null;
  let slope: bigint;
  if (a.x === b.x && a.y === b.y) {
    slope = mod(3n * a.x * a.x * modInverse(2n * a.y, P), P);
  } else {
    slope = mod((b.y - a.y) * modInverse(b.x - a.x, P), P);
  }
  const x = mod(slope * slope - a.x - b.x, P);
  const y = mod(slope * (a.x - x) - a.y, P);
  return { x, y };
}

function pointMultiply(scalar: bigint, point: Point): Point | null {
  let result: Point | null = null;
  let addend: Point | null = point;
  let k = mod(scalar, N);
  while (k > 0n) {
    if (k & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    k >>= 1n;
  }
  return result;
}

function bigintToBuffer(value: bigint, length = 32): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

/** The 33-byte compressed public key for a private key. */
export function compressedPublicKey(privateKey: bigint): Buffer {
  const point = pointMultiply(privateKey, { x: GX, y: GY });
  if (point === null) throw new Error('invalid private key');
  const prefix = point.y % 2n === 0n ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), bigintToBuffer(point.x)]);
}

/** The 65-byte uncompressed public key (`0x04 || x || y`). */
export function uncompressedPublicKey(privateKey: bigint): Buffer {
  const point = pointMultiply(privateKey, { x: GX, y: GY });
  if (point === null) throw new Error('invalid private key');
  return Buffer.concat([Buffer.from([0x04]), bigintToBuffer(point.x), bigintToBuffer(point.y)]);
}

/** The BIP-39 seed for a mnemonic. An empty passphrase is the standard default. */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Buffer {
  const normalized = mnemonic.normalize('NFKD');
  const salt = `mnemonic${passphrase}`.normalize('NFKD');
  return pbkdf2Sync(normalized, salt, 2048, 64, 'sha512');
}

interface ExtendedKey {
  privateKey: bigint;
  chainCode: Buffer;
}

/** The BIP-32 master key for a seed. */
export function masterKey(seed: Buffer): ExtendedKey {
  const digest = createHmac('sha512', Buffer.from('Bitcoin seed', 'utf8')).update(seed).digest();
  const privateKey = BigInt(`0x${digest.subarray(0, 32).toString('hex')}`);
  if (privateKey === 0n || privateKey >= N) throw new Error('invalid master key');
  return { privateKey, chainCode: digest.subarray(32) };
}

/** Derive one child key. `index` values at or above 2^31 are hardened. */
export function deriveChild(parent: ExtendedKey, index: number): ExtendedKey {
  if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
    throw new Error('child index must be a 32-bit unsigned integer');
  }

  const data =
    index >= HARDENED
      ? Buffer.concat([Buffer.from([0x00]), bigintToBuffer(parent.privateKey), Buffer.from(uint32(index))])
      : Buffer.concat([compressedPublicKey(parent.privateKey), Buffer.from(uint32(index))]);

  const digest = createHmac('sha512', parent.chainCode).update(data).digest();
  const tweak = BigInt(`0x${digest.subarray(0, 32).toString('hex')}`);
  const privateKey = mod(tweak + parent.privateKey, N);
  if (privateKey === 0n) throw new Error('derived key is invalid');
  return { privateKey, chainCode: digest.subarray(32) };
}

function uint32(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

/** Derive a key along a path such as `m/44'/60'/0'/0/0`. */
export function derivePath(seed: Buffer, path: string): bigint {
  const segments = path.split('/');
  if (segments[0] !== 'm') throw new Error('a derivation path must start with "m"');

  let key = masterKey(seed);
  for (const segment of segments.slice(1)) {
    const hardened = segment.endsWith("'") || segment.endsWith('h');
    const value = Number(hardened ? segment.slice(0, -1) : segment);
    if (!Number.isInteger(value) || value < 0 || value >= HARDENED) {
      throw new Error(`invalid derivation path segment: ${segment}`);
    }
    key = deriveChild(key, hardened ? value + HARDENED : value);
  }
  return key.privateKey;
}

/** The EIP-55 checksummed address for a private key. */
export function addressForPrivateKey(privateKey: bigint): string {
  const publicKey = uncompressedPublicKey(privateKey);
  const hash = keccak256Hex(publicKey.subarray(1));
  const address = `0x${hash.slice(-40)}`;
  const checksummed = toChecksumAddress(address);
  if (!checksummed) throw new Error('derived address is invalid');
  return checksummed;
}

/**
 * Derive the EVM address at `m/44'/60'/0'/0/index` for a mnemonic.
 *
 * The mnemonic is validated for word count and character set before any key
 * material is produced, so an obviously malformed seed fails fast.
 */
export function deriveEvmAddress(mnemonic: string, index: number): string {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error('a mnemonic must contain 12, 15, 18, 21 or 24 words');
  }
  if (words.some((word) => !/^[a-z]+$/.test(word))) {
    throw new Error('a mnemonic may only contain lowercase letters');
  }
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error('derivation index must be an unsigned 31-bit integer');
  }

  const seed = mnemonicToSeed(words.join(' '));
  const privateKey = derivePath(seed, `m/44'/60'/0'/0/${index}`);
  return addressForPrivateKey(privateKey);
}

/** Whether a network uses EVM-style addresses, which this module can derive. */
export function isEvmNetwork(network: string): boolean {
  return isEvmChainNetwork(network);
}

/**
 * Derive the EVM private key at `m/44'/60'/0'/0/index` for a mnemonic.
 *
 * This is the signing counterpart to `deriveEvmAddress` and is used only by the
 * payout path. The returned value is secret key material: it must never be
 * logged, serialized into a response, or written to a row.
 */
export function deriveEvmPrivateKey(mnemonic: string, index: number): string {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error('a mnemonic must contain 12, 15, 18, 21 or 24 words');
  }
  if (words.some((word) => !/^[a-z]+$/.test(word))) {
    throw new Error('a mnemonic may only contain lowercase letters');
  }
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error('derivation index must be an unsigned 31-bit integer');
  }

  const seed = mnemonicToSeed(words.join(' '));
  const privateKey = derivePath(seed, `m/44'/60'/0'/0/${index}`);
  return `0x${privateKey.toString(16).padStart(64, '0')}`;
}
