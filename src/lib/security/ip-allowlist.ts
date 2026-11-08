/**
 * IPv4/IPv6 parsing and allowlist matching.
 *
 * Pure logic with no framework imports so the rules can be unit tested. The
 * matcher is intentionally strict: anything it cannot parse is treated as "no
 * match", so a malformed allowlist entry can never widen access, and a request
 * whose address cannot be parsed is refused rather than allowed.
 */

export interface ParsedIp {
  version: 4 | 6;
  bytes: Uint8Array;
}

/** Parse a dotted-quad IPv4 address into four bytes, or null. */
function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i];
    // Reject leading zeros and empty octets: "01" is not a valid IPv4 octet.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    bytes[i] = octet;
  }
  return bytes;
}

/** Parse an IPv6 address (with `::` compression) into sixteen bytes, or null. */
function parseIpv6(value: string): Uint8Array | null {
  let input = value;
  // A zone index (fe80::1%eth0) is not part of the address.
  const zone = input.indexOf('%');
  if (zone !== -1) input = input.slice(0, zone);
  if (input.length === 0) return null;

  // A trailing dotted-quad is two groups: ::ffff:192.168.0.1
  let tailBytes: number[] = [];
  const lastColon = input.lastIndexOf(':');
  const tail = input.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    tailBytes = [v4[0], v4[1], v4[2], v4[3]];
    // Replace the four trailing bytes with two placeholder groups.
    input = input.slice(0, lastColon + 1) + '0:0';
  }

  const doubleIndex = input.indexOf('::');
  if (doubleIndex !== input.lastIndexOf('::')) return null; // at most one "::"

  const head = doubleIndex === -1 ? input : input.slice(0, doubleIndex);
  const rest = doubleIndex === -1 ? '' : input.slice(doubleIndex + 2);

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const headGroups = parseGroups(head);
  const restGroups = parseGroups(rest);
  if (headGroups === null || restGroups === null) return null;

  let groups: number[];
  if (doubleIndex === -1) {
    groups = headGroups;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - headGroups.length - restGroups.length;
    if (missing < 1) return null;
    groups = [...headGroups, ...new Array(missing).fill(0), ...restGroups];
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  // Fold the dotted-quad tail over the final four bytes.
  if (tailBytes.length === 4) {
    bytes[12] = tailBytes[0];
    bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2];
    bytes[15] = tailBytes[3];
  }
  return bytes;
}

export function parseIp(value: string): ParsedIp | null {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) return null;
  const v4 = parseIpv4(trimmed);
  if (v4) return { version: 4, bytes: v4 };
  const v6 = parseIpv6(trimmed);
  if (v6) return { version: 6, bytes: v6 };
  return null;
}

export interface ParsedCidr {
  version: 4 | 6;
  bytes: Uint8Array;
  prefix: number;
}

/**
 * Parse an allowlist entry: a bare address or an address with a prefix length.
 *
 * A bare address is treated as a host route, so "10.0.0.1" allows exactly that
 * address and "10.0.0.0/8" allows the whole range.
 */
export function parseCidr(value: string): ParsedCidr | null {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) return null;

  const slash = trimmed.lastIndexOf('/');
  const addressPart = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const ip = parseIp(addressPart);
  if (!ip) return null;

  const maxPrefix = ip.version === 4 ? 32 : 128;
  let prefix = maxPrefix;
  if (slash !== -1) {
    const raw = trimmed.slice(slash + 1);
    if (!/^\d{1,3}$/.test(raw)) return null;
    prefix = Number(raw);
    if (prefix > maxPrefix) return null;
  }

  // Zero the host bits so the stored network is canonical.
  const bytes = Uint8Array.from(ip.bytes);
  for (let bit = prefix; bit < maxPrefix; bit += 1) {
    bytes[bit >> 3] &= ~(0x80 >> (bit & 7));
  }

  return { version: ip.version, bytes, prefix };
}

/** Whether an address falls inside a parsed CIDR block. */
export function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) return false;
  let remaining = cidr.prefix;
  for (let i = 0; i < cidr.bytes.length && remaining > 0; i += 1) {
    const bits = Math.min(8, remaining);
    const mask = bits === 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((cidr.bytes[i] & mask) !== (ip.bytes[i] & mask)) return false;
    remaining -= bits;
  }
  return true;
}

/**
 * Whether an address matches any allowlist entry.
 *
 * An empty or entirely unparseable allowlist never matches, so enabling the
 * control without a usable entry blocks sign-in instead of permitting it.
 */
export function ipAllowed(address: string, allowlist: readonly string[]): boolean {
  const ip = parseIp(address);
  if (!ip) return false;
  for (const entry of allowlist) {
    const cidr = parseCidr(entry);
    if (cidr && cidrContains(cidr, ip)) return true;
  }
  return false;
}
