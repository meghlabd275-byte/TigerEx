/**
 * Session token accessors for TigerEx API calls.
 *
 * The login flow writes trader sessions to `tigerex_access_token` and the admin
 * console writes its session to `tigerex_admin_token`. Those are the only two
 * keys anything writes: `tigerex_token`, `admin_token` and `token` are read by
 * some views but written by none, so a reader that consulted them sent no
 * credential and appeared empty. Everything reads through here instead.
 */

/** The trader session token, or null when signed out. */
export function readAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('tigerex_access_token');
}

/**
 * The admin session token, or null when not signed in to the console.
 *
 * Admin routes authenticate against `admin_sessions`, which is a distinct
 * privilege from a trader session, so an admin view must present this token and
 * never the trader one.
 */
export function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('tigerex_admin_token');
}

/**
 * The token an API path requires.
 *
 * A route under `/api/admin` authenticates against `admin_sessions`, which is a
 * distinct privilege from a trader session, so it must receive the admin token
 * and never the trader one. Every other route is a trader route. Deriving the
 * choice from the path keeps a caller from having to know which kind of session
 * it holds, and stops an admin view from sending the wrong credential.
 */
export function tokenForPath(path: string): string | null {
  return path.startsWith('/api/admin') ? readAdminToken() : readAuthToken();
}
