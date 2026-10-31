// Single source of truth for the backend the frontend talks to.
//
// The endpoints are configured per deployment through NEXT_PUBLIC_API_URL and
// NEXT_PUBLIC_WS_URL. There is no built-in production host: a deployment that
// forgets to set them would otherwise send user traffic to a domain we do not
// control, so production is failed closed and the browser falls back to the
// same origin it was served from.

const isProduction = process.env.NODE_ENV === 'production';

function resolveHttpBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (isProduction) return '';
  return 'http://localhost:8080/api/v1';
}

function resolveWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (isProduction) {
    // Derive from the page origin so the socket is same-origin, not a host
    // baked into the bundle.
    if (typeof window !== 'undefined') {
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${scheme}//${window.location.host}/ws`;
    }
    return '';
  }
  return 'ws://localhost:8080/ws';
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
