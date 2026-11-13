// Single source of truth for the backend the frontend talks to.
//
// The exchange is self-contained: the same Next.js process serves the REST and
// WebSocket surface, so the default is same-origin and never a host baked into
// the bundle. A deployment that fronts the handlers with a separate origin sets
// NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL; when it does not, the browser falls
// back to the origin it was served from rather than a developer machine.

function resolveHttpBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  // Same-origin: the in-app `/api/**` handlers are the exchange's own API.
  return '';
}

function resolveWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/\/$/, '');
  // Derive from the page origin so the socket is same-origin, not a host baked
  // into the bundle.
  if (typeof window !== 'undefined') {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.host}/api/market/stream`;
  }
  return '';
}

export const API_BASE_URL = resolveHttpBase();
export const WS_BASE_URL = resolveWsBase();

/** Absolute REST URL for a path such as `/markets`. */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WebSocket URL for a channel, e.g. `btcusdt` or `btcusdt@depth`. */
export function wsUrl(channel?: string): string {
  return channel ? `${WS_BASE_URL}/${channel}` : WS_BASE_URL;
}
