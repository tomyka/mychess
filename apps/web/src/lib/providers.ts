/** The OAuth providers an account signs in with and links (R-69, R-83). */
const PROVIDERS = ['google', 'lichess'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const isProvider = (value: string): value is Provider =>
  PROVIDERS.some((provider) => provider === value);

/** The providers to offer: Google only when the server has its credentials. */
export const offeredProviders = (googleEnabled: boolean): Provider[] =>
  PROVIDERS.filter((provider) => googleEnabled || provider !== 'google');
