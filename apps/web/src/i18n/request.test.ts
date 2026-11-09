import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from './locales';

interface RequestState {
  account: { readonly locale: 'lt' | 'en' } | null;
  cookie: string | undefined;
  /** The per-request function request.ts hands next-intl. */
  config: (() => Promise<unknown>) | null;
}

const request = vi.hoisted((): RequestState => ({
  account: null,
  cookie: undefined,
  config: null,
}));

vi.mock('next-intl/server', () => ({
  getRequestConfig: (config: () => Promise<unknown>) => {
    request.config = config;
    return config;
  },
}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'NEXT_LOCALE' && request.cookie !== undefined
          ? { value: request.cookie }
          : undefined,
    }),
}));
vi.mock('../server/session', () => ({
  getAccount: () => Promise.resolve(request.account),
}));

/** The locale and catalogue the page renders with. */
async function rendered(): Promise<unknown> {
  await import('./request');
  if (request.config === null) throw new Error('request.ts gave no config');
  return request.config();
}

beforeEach(() => {
  request.account = null;
  request.cookie = undefined;
});

describe('the request locale (R-180)', () => {
  it('renders English for a signed-in account stored in Lithuanian', async () => {
    request.account = { locale: 'lt' };
    request.cookie = 'lt';
    expect(await rendered()).toEqual({ locale: 'en', messages: MESSAGES.en });
  });

  it('renders English for a visitor whose cookie says Lithuanian', async () => {
    request.cookie = 'lt';
    expect(await rendered()).toEqual({ locale: 'en', messages: MESSAGES.en });
  });

  it('renders English with no account and no cookie', async () => {
    expect(await rendered()).toEqual({ locale: 'en', messages: MESSAGES.en });
  });
});
