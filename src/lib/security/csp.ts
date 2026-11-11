/**
 * Content-Security-Policy construction.
 *
 * Kept free of `next/server` so the policy can be unit-tested directly: the
 * middleware that applies it cannot be exercised by the plain-Node logic suite,
 * but the string it produces can, and that string is the part that either does
 * or does not neutralise an injected script.
 */

/** Same-origin, plus the configured API origin when one is set. */
export function connectSources(
  apiUrl: string | undefined,
  production: boolean,
): string {
  const sources = new Set<string>(["'self'", "https:", "wss:"]);
  const configured = apiUrl?.trim();
  if (configured) {
    try {
      sources.add(new URL(configured).origin);
    } catch {
      // A relative base such as "/api" is already covered by 'self'.
    }
  }
  if (!production) {
    sources.add("ws:");
    sources.add("http:");
  }
  return [...sources].join(" ");
}

/**
 * Build the policy for a given nonce.
 *
 * `script-src` carries the nonce and `strict-dynamic` and deliberately not
 * `unsafe-inline`: with `unsafe-inline` present a browser runs any injected
 * inline script, which is exactly the payload the policy exists to stop.
 */
export function buildCsp(nonce: string, options: { apiUrl?: string; production: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    `connect-src ${connectSources(options.apiUrl, options.production)}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (options.production) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}
