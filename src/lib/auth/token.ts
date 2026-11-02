/**
 * Resolve the bearer token for TigerEx API calls.
 *
 * The login flow stores trader sessions under `tigerex_access_token` and the
 * admin console stores its session under `tigerex_admin_token`. Several views
 * read `tigerex_token` or `token`, which nothing writes, so they sent no
 * credential and appeared empty. All of them read through here instead.
 */
export function readAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    localStorage.getItem('tigerex_admin_token') ||
    localStorage.getItem('tigerex_access_token') ||
    localStorage.getItem('admin_token')
  );
}
