/**
 * Client-safe list of the social providers the sign-in UI offers.
 *
 * Kept separate from `lib/auth/oidc.ts` so the browser bundle never pulls in
 * the server-only crypto and database code. The ids must match the keys of
 * `OIDC_PROVIDERS`; a provider the server cannot verify is not offered here.
 */
export interface SocialProviderMeta {
  id: string;
  label: string;
}

export const SOCIAL_PROVIDERS: SocialProviderMeta[] = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'microsoft', label: 'Microsoft' },
];

/** The providers offered in the overflow menu, i.e. all but the two shown inline. */
export const SOCIAL_PROVIDERS_MENU: SocialProviderMeta[] = SOCIAL_PROVIDERS.filter(
  (provider) => provider.id !== 'google' && provider.id !== 'apple',
);
