import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '@mychess/domain';
import {
  MESSAGES,
  OFFERED_LOCALES,
  OFFERS_LANGUAGE_CHOICE,
  resolveLocale,
} from './locales';

// Every key path in a catalogue, as 'app.title'.
function keyPaths(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]: [string, unknown]) =>
    typeof value === 'object' && value !== null
      ? keyPaths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('resolveLocale', () => {
  it('offers English only for now (R-180)', () => {
    expect(OFFERED_LOCALES).toEqual(['en']);
    expect(OFFERS_LANGUAGE_CHOICE).toBe(false);
  });

  it('serves English for a Lithuanian account or cookie, which stay stored as they are', () => {
    // The domain's stored default is untouched, so Lithuanian can come back.
    expect(DEFAULT_LOCALE).toBe('lt');
    expect(resolveLocale('lt')).toBe('en');
  });

  it('takes an offered locale', () => {
    expect(resolveLocale('en')).toBe('en');
  });

  it.each([undefined, 'de', '', 'LT', 'en-GB'])(
    'falls back to the first offered locale for %j',
    (value) => {
      expect(resolveLocale(value)).toBe('en');
    },
  );
});

describe('the message catalogues', () => {
  it('have the same keys in every language', () => {
    expect(keyPaths(MESSAGES.en)).toEqual(keyPaths(MESSAGES.lt));
  });

  it('name the site in both', () => {
    expect(MESSAGES.lt.app.title).toBe('MyChess');
    expect(MESSAGES.en.app.title).toBe('MyChess');
  });

  it('write the brand as MyChess in every text (R-170)', () => {
    for (const messages of [MESSAGES.lt, MESSAGES.en]) {
      const texts = JSON.stringify(messages);
      // A host (mychess.lt, @mychess.test) is a domain, not the brand.
      const brands = [...texts.matchAll(/mychess(?!\.(?:lt|test)\b)/giu)];
      expect(brands.map(([found]) => found)).toEqual(
        brands.map(() => 'MyChess'),
      );
      expect(brands.length).toBeGreaterThan(0);
    }
  });
});
