/**
 * Resolve the base URL of the internal trading backend.
 *
 * Server-side route handlers forward the caller's bearer token to the backend.
 * A default of `http://localhost:8080` would send a live credential in
 * cleartext to whatever happens to be listening on the local loopback interface
 * when the deployment forgets to configure the URL, so there is no default.
 *
 * In production the URL must be an absolute `https://` origin. In development a
 * plain `http://` origin is allowed for a local backend. When the URL is missing
 * or unsuitable the caller receives `null` and must fail closed.
 */
export function backendBaseUrl(): string | null {
  const raw = process.env.TIGEREX_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol === 'https:') return raw.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:') {
    return raw.replace(/\/$/, '');
  }
  return null;
}
