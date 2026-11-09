/**
 * Presentation helpers for the TigerSwap views.
 *
 * These are pure and safe to import from a client component: they format a
 * value that came from the API, and never invent one. A missing or non-finite
 * number renders as an em dash so an absent price is never shown as a zero.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A number from the API, coerced safely; returns null when it is not finite. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function withDigits(value: number, digits: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A USD amount, or an em dash when the value is unknown. */
export function formatUsd(value: unknown, digits = 2): string {
  const n = toNumber(value);
  return n === null ? '—' : `$${withDigits(n, digits)}`;
}

/** An asset amount, or an em dash when the value is unknown. */
export function formatAmount(value: unknown, digits = 6): string {
  const n = toNumber(value);
  if (n === null) return '—';
  if (n !== 0 && Math.abs(n) < 10 ** -digits) return `<${10 ** -digits}`;
  return withDigits(n, digits);
}

/** A fraction rendered as a percentage, or an em dash when unknown. */
export function formatPercent(value: unknown, digits = 2): string {
  const n = toNumber(value);
  return n === null ? '—' : `${withDigits(n * 100, digits)}%`;
}

/** A number with a fixed number of decimal places. */
export function formatNumber(value: unknown, digits = 2): string {
  const n = toNumber(value);
  return n === null ? '—' : withDigits(n, digits);
}

/** A shortened identifier for a pool, position or address. */
export function shortenId(value: unknown, head = 8, tail = 6): string {
  const text = String(value ?? '');
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** A pool's token pair as a display label, e.g. `RUSD / ETH`. */
export function pairLabel(tokens: unknown): string {
  if (!Array.isArray(tokens) || tokens.length === 0) return '—';
  return tokens.map((token) => String(token)).join(' / ');
}
