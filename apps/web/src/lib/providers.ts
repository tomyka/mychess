import { GOOGLE, PROVIDERS, type Provider } from '@mychess/domain';

/** The providers to offer: Google only when the server has its credentials. */
export const offeredProviders = (googleEnabled: boolean): Provider[] =>
  PROVIDERS.filter((provider) => googleEnabled || provider !== GOOGLE);
