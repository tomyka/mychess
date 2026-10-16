import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@mychess/domain';
import { MESSAGES, resolveLocale } from './locales';

// Every key path in a catalogue, as 'app.title'.
function keyPaths(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]: [string, unknown]) =>
    typeof value === 'object' && value !== null
      ? keyPaths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('resolveLocale', () => {
  it('defaults to Lithuanian', () => {
    expect(DEFAULT_LOCALE).toBe('lt');
    expect(resolveLocale(undefined)).toBe('lt');
  });

  it.each(['lt', 'en'] as const)('takes the supported locale %s', (locale) => {
    expect(resolveLocale(locale)).toBe(locale);
  });

  it.each(['de', '', 'LT', 'en-GB'])(
    'falls back to Lithuanian for %j',
    (value) => {
      expect(resolveLocale(value)).toBe('lt');
    },
  );
});

describe('the message catalogues', () => {
  it('have the same keys in every language', () => {
    expect(keyPaths(MESSAGES.en)).toEqual(keyPaths(MESSAGES.lt));
  });

  it('name the site in both', () => {
    expect(MESSAGES.lt.app.title).toBe('mychess');
    expect(MESSAGES.en.app.title).toBe('mychess');
  });
});
