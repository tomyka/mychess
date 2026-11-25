import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readThemeCookie } from './theme-cookie';

const cookie = vi.hoisted(() =>
  vi.fn<(name: string) => { value: string } | undefined>(),
);

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookie }),
}));

beforeEach(() => {
  cookie.mockReset().mockReturnValue(undefined);
});

describe('readThemeCookie', () => {
  it('is the system theme without a cookie', async () => {
    await expect(readThemeCookie()).resolves.toBe('system');
  });

  it('reads the theme cookie', async () => {
    cookie.mockImplementation((name) =>
      name === 'theme' ? { value: 'dark' } : undefined,
    );
    await expect(readThemeCookie()).resolves.toBe('dark');
  });

  it('takes an unknown theme cookie for the system theme', async () => {
    cookie.mockReturnValue({ value: 'neon' });
    await expect(readThemeCookie()).resolves.toBe('system');
  });
});
