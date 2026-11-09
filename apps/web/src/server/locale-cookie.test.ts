import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberLocale } from './locale-cookie';

const jar = vi.hoisted(() => ({
  set: vi.fn<(name: string, value: string, options: object) => void>(),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: jar.set }),
}));

beforeEach(() => {
  jar.set.mockReset();
});

describe('rememberLocale', () => {
  it.each(['lt', 'en'] as const)(
    'leaves the locale cookie as it is while no language choice is offered: %s (R-180)',
    async (locale) => {
      await rememberLocale(locale);
      expect(jar.set).not.toHaveBeenCalled();
    },
  );
});
