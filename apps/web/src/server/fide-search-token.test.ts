import { broadcastMonthSchema, fideIdSchema } from '@mychess/domain';
import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SEARCH_TOKEN_TTL_MS,
  readSearchToken,
  signSearchToken,
} from './fide-search-token';

const SECRET = 'a-test-secret-of-at-least-32-characters!';
const NOW = new Date('2026-11-10T10:00:00Z');
const ID = fideIdSchema.parse(13_400_002);
const MONTHS = ['2026-10', '2026-09'].map((m) => broadcastMonthSchema.parse(m));

const sign = (accountId = 'rokas', at = NOW) =>
  signSearchToken(SECRET, { accountId, fideId: ID, months: MONTHS }, at);

const later = (ms: number) => new Date(NOW.getTime() + ms);

/** `token` with one character of its part `index` changed. */
function tampered(token: string, index: 0 | 1): string {
  const parts = token.split('.');
  const part = parts[index] ?? '';
  const flipped = (part.startsWith('A') ? 'B' : 'A') + part.slice(1);
  parts[index] = flipped;
  return parts.join('.');
}

describe('the FIDE search token', () => {
  it('gives back the searched ID and months to the account it was signed for', () => {
    expect(readSearchToken(SECRET, sign(), 'rokas', later(1000))).toEqual({
      ok: true,
      value: { fideId: ID, months: MONTHS },
    });
  });

  it('holds while the hour lasts and expires at its end', () => {
    expect(
      readSearchToken(SECRET, sign(), 'rokas', later(SEARCH_TOKEN_TTL_MS - 1))
        .ok,
    ).toBe(true);
    expect(
      readSearchToken(SECRET, sign(), 'rokas', later(SEARCH_TOKEN_TTL_MS)),
    ).toEqual({ ok: false, refusal: { reason: 'fide.searchExpired' } });
    expect(SEARCH_TOKEN_TTL_MS).toBe(60 * 60_000);
  });

  it('is refused to another account', () => {
    expect(readSearchToken(SECRET, sign(), 'gabija', NOW).ok).toBe(false);
  });

  it('is refused when signed with another secret', () => {
    const other = signSearchToken(
      'another-secret-of-at-least-32-characters',
      { accountId: 'rokas', fideId: ID, months: MONTHS },
      NOW,
    );
    expect(readSearchToken(SECRET, other, 'rokas', NOW).ok).toBe(false);
  });

  it('is refused when its payload or its signature was changed', () => {
    expect(readSearchToken(SECRET, tampered(sign(), 0), 'rokas', NOW).ok).toBe(
      false,
    );
    expect(readSearchToken(SECRET, tampered(sign(), 1), 'rokas', NOW).ok).toBe(
      false,
    );
  });

  it('refuses a payload for another ID even with the first one’s signature', () => {
    const [, mac] = sign().split('.');
    const forged = Buffer.from(
      JSON.stringify({
        a: 'rokas',
        f: 1,
        m: ['2026-10'],
        e: later(SEARCH_TOKEN_TTL_MS).getTime(),
      }),
    ).toString('base64url');
    expect(
      readSearchToken(SECRET, `${forged}.${mac ?? ''}`, 'rokas', NOW).ok,
    ).toBe(false);
  });

  it.each([undefined, 42, '', 'no-dot', 'a.b.c', '.', 'x'.repeat(5000)])(
    'refuses %j, which is no token',
    (raw) => {
      expect(readSearchToken(SECRET, raw, 'rokas', NOW)).toEqual({
        ok: false,
        refusal: { reason: 'fide.searchExpired' },
      });
    },
  );

  it('is signed under a key derived from the secret by HKDF (security L2)', () => {
    const [payload = '', signature] = sign().split('.');
    const key = Buffer.from(
      hkdfSync('sha256', SECRET, 'mychess', 'fide-search-token v1', 32),
    );
    expect(signature).toBe(
      createHmac('sha256', key).update(payload).digest('base64url'),
    );
  });

  it('names at most the 12 months a search covers', () => {
    const thirteen = Array.from({ length: 13 }, (_, n) =>
      broadcastMonthSchema.parse(
        `2025-${String((n % 12) + 1).padStart(2, '0')}`,
      ),
    );
    const token = signSearchToken(
      SECRET,
      { accountId: 'rokas', fideId: ID, months: thirteen },
      NOW,
    );
    expect(readSearchToken(SECRET, token, 'rokas', NOW).ok).toBe(false);
  });

  it('differs for two searches of the same ID a moment apart', () => {
    expect(sign('rokas', NOW)).not.toBe(sign('rokas', later(1)));
  });
});
