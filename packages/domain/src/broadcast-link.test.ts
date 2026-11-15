import { describe, expect, it } from 'vitest';
import {
  BROADCAST_LINK_MAX,
  BROADCAST_LINK_REFUSAL,
  parseBroadcastLink,
} from './broadcast-link';

const TOUR = 'https://lichess.org/broadcast/synthetic-open-2026/Ab3dEf7h';
const ROUND =
  'https://lichess.org/broadcast/synthetic-open-2026/round-3/Zx9yW8v7';

const refused = { ok: false, refusal: { reason: 'fide.broadcastLinkInvalid' } };

describe('parseBroadcastLink (#349, R-197, spec decision 4)', () => {
  it('refuses with a message-catalogue key, past a length cap', () => {
    expect(BROADCAST_LINK_REFUSAL).toBe('fide.broadcastLinkInvalid');
    expect(BROADCAST_LINK_MAX).toBe(500);
  });

  it('reads a tournament link as its tournament id', () => {
    expect(parseBroadcastLink(TOUR)).toEqual({
      ok: true,
      value: { kind: 'tour', tourId: 'Ab3dEf7h' },
    });
  });

  it('reads a round link as its round id', () => {
    expect(parseBroadcastLink(ROUND)).toEqual({
      ok: true,
      value: { kind: 'round', roundId: 'Zx9yW8v7' },
    });
  });

  it("reads a round's game link as its round id", () => {
    expect(parseBroadcastLink(`${ROUND}/Qr5sT6u7`)).toEqual({
      ok: true,
      value: { kind: 'round', roundId: 'Zx9yW8v7' },
    });
  });

  it.each([`${TOUR}/`, `${TOUR}#overview`, `${TOUR}?embed=1`, `${TOUR}/#x`])(
    'ignores a trailing slash, fragment or query: %s',
    (link) => {
      expect(parseBroadcastLink(link)).toEqual({
        ok: true,
        value: { kind: 'tour', tourId: 'Ab3dEf7h' },
      });
    },
  );

  it('ignores spaces around a pasted link', () => {
    expect(parseBroadcastLink(`  ${ROUND}\n`).ok).toBe(true);
  });

  it.each([
    ['plain http', TOUR.replace('https:', 'http:')],
    ['another host', TOUR.replace('lichess.org', 'lichess.org.evil.example')],
    ['a subdomain', TOUR.replace('lichess.org', 'www.lichess.org')],
    ['an upper-case host', TOUR.replace('lichess.org', 'Lichess.org')],
    ['credentials', TOUR.replace('lichess.org', 'user:pass@lichess.org')],
    ['a port', TOUR.replace('lichess.org', 'lichess.org:443')],
    ['another path', 'https://lichess.org/study/Ab3dEf7h'],
    ['no id', 'https://lichess.org/broadcast/synthetic-open-2026'],
    ['a short id', TOUR.slice(0, -1)],
    ['a long id', `${TOUR}x`],
    ['an id with a dash', TOUR.replace('Ab3dEf7h', 'Ab3d-f7h')],
    ['a dot segment', 'https://lichess.org/broadcast/../Ab3dEf7h'],
    ['an encoded character', TOUR.replace('synthetic', 'synth%2Fetic')],
    ['spaces inside', TOUR.replace('synthetic', 'synth etic')],
    ['a control character in the query', `${TOUR}?a=\u0000`],
    ['a backslash', TOUR.replace('/Ab3dEf7h', '\\Ab3dEf7h')],
    ['no scheme', TOUR.replace('https://', '')],
    ['nothing', ''],
  ])('refuses %s', (_, link) => {
    expect(parseBroadcastLink(link)).toEqual(refused);
  });

  it('refuses a link longer than the cap, even a valid one', () => {
    const long = `${TOUR}?${'a'.repeat(BROADCAST_LINK_MAX)}`;
    expect(parseBroadcastLink(long)).toEqual(refused);
    const atCap = `${TOUR}?${'a'.repeat(BROADCAST_LINK_MAX - TOUR.length - 1)}`;
    expect(atCap).toHaveLength(BROADCAST_LINK_MAX);
    expect(parseBroadcastLink(atCap).ok).toBe(true);
  });
});
