import { describe, expect, it } from 'vitest';
import {
  BROADCAST_GAME_ISSUE,
  BROADCAST_RESULTS,
  BROADCAST_TEXT_MAX,
  LICHESS_GAME_URL,
  broadcastGameSchema,
  gameForPlayer,
  isIndexableGame,
  type BroadcastGameInput,
  type BroadcastPairing,
} from './broadcast-game';
import { fideIdSchema, type FideId } from './fide-id';

const id = (n: number): FideId => fideIdSchema.parse(n);
const maybeId = (n: number | null): FideId | null =>
  n === null ? null : id(n);

const game = (overrides: Partial<BroadcastPairing> = {}): BroadcastPairing => ({
  white: 'Player, White',
  whiteFideId: id(100),
  black: 'Player, Black',
  blackFideId: id(200),
  result: '1-0',
  ...overrides,
});

describe('gameForPlayer (#316, R-185)', () => {
  it('gives the white player the black opponent', () => {
    expect(gameForPlayer(game(), id(100))).toEqual({
      colour: 'white',
      opponent: { name: 'Player, Black', fideId: 200 },
      outcome: 'win',
    });
  });

  it('gives the black player the white opponent', () => {
    expect(gameForPlayer(game(), id(200))).toEqual({
      colour: 'black',
      opponent: { name: 'Player, White', fideId: 100 },
      outcome: 'loss',
    });
  });

  it('keeps an opponent without a FIDE ID', () => {
    expect(
      gameForPlayer(game({ blackFideId: null }), id(100)).opponent,
    ).toEqual({ name: 'Player, Black', fideId: null });
  });

  it.each([
    ['1-0', 100, 'win'],
    ['1-0', 200, 'loss'],
    ['0-1', 100, 'loss'],
    ['0-1', 200, 'win'],
    ['1/2-1/2', 100, 'draw'],
    ['1/2-1/2', 200, 'draw'],
    ['*', 100, 'unknown'],
    ['*', 200, 'unknown'],
  ] as const)('reads %s for player %d as a %s', (result, player, outcome) => {
    expect(gameForPlayer(game({ result }), id(player)).outcome).toBe(outcome);
  });

  it('throws for a game the player is not in: the search never returns one', () => {
    expect(() => gameForPlayer(game(), id(300))).toThrow(RangeError);
  });

  it('throws for a game with the player on both sides: the index never holds one', () => {
    expect(() =>
      gameForPlayer(
        game({ whiteFideId: id(100), blackFideId: id(100) }),
        id(100),
      ),
    ).toThrow(RangeError);
  });
});

describe('isIndexableGame (#316, spec decision 1)', () => {
  it.each([
    [100, 200, true],
    [100, null, true],
    [null, 200, true],
    [null, null, false],
    [100, 100, false],
  ] as const)(
    'white %s, black %s, is indexed: %s',
    (white, black, indexable) => {
      expect(
        isIndexableGame(
          game({ whiteFideId: maybeId(white), blackFideId: maybeId(black) }),
        ),
      ).toBe(indexable);
    },
  );
});

describe('BROADCAST_RESULTS', () => {
  it('lists the four PGN results', () => {
    expect(BROADCAST_RESULTS).toEqual(['1-0', '0-1', '1/2-1/2', '*']);
  });
});

describe('LICHESS_GAME_URL (#316, security M1)', () => {
  const pattern = new RegExp(LICHESS_GAME_URL);

  it('holds no quote, so a check constraint can inline it', () => {
    expect(LICHESS_GAME_URL).not.toContain("'");
  });

  it.each([
    'https://lichess.org/broadcast/synthetic-open/round-1/AbCd1234',
    'https://lichess.org/AbCd1234',
    'https://lichess.org/broadcast/a_b/c-d/0',
  ])('accepts %j', (url) => {
    expect(pattern.test(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'http://lichess.org/AbCd1234',
    'https://lichess.org.example.com/AbCd1234',
    'https://example.com/lichess.org/AbCd1234',
    'https://lichessXorg/AbCd1234',
    'https://lichess.org/',
    'https://lichess.org/a?b=c',
    'https://lichess.org/a#b',
    'https://lichess.org/a b',
    'https://lichess.org/a"b',
    "https://lichess.org/a'b",
    'https://lichess.org/a<b',
    'https://lichess.org/a\nb',
    ' https://lichess.org/a',
  ])('refuses %j', (url) => {
    expect(pattern.test(url)).toBe(false);
  });
});

describe('broadcastGameSchema (#316, security M3)', () => {
  const record = (
    overrides: Partial<BroadcastGameInput> = {},
  ): BroadcastGameInput => ({
    url: 'https://lichess.org/broadcast/synthetic-open/round-1/AbCd1234',
    white: 'Player, White',
    whiteFideId: 100,
    black: 'Player, Black',
    blackFideId: 200,
    date: '2025-01-05',
    result: '1-0',
    eco: 'B90',
    opening: 'Sicilian Defense',
    event: 'Synthetic Open',
    ...overrides,
  });

  it('keeps a valid game', () => {
    expect(broadcastGameSchema.parse(record())).toEqual(record());
  });

  it('keeps a game without date, ECO, opening or one FIDE ID', () => {
    const sparse = record({
      date: null,
      eco: null,
      opening: null,
      blackFideId: null,
    });
    expect(broadcastGameSchema.parse(sparse)).toEqual(sparse);
  });

  it('trims the names, the event and the opening', () => {
    expect(
      broadcastGameSchema.parse(
        record({ white: ' W ', black: ' B ', event: ' E ', opening: ' O ' }),
      ),
    ).toMatchObject({ white: 'W', black: 'B', event: 'E', opening: 'O' });
  });

  it('keeps a text of the most characters allowed', () => {
    expect(BROADCAST_TEXT_MAX).toBe(200);
    const name = 'x'.repeat(BROADCAST_TEXT_MAX);
    expect(broadcastGameSchema.parse(record({ white: name })).white).toBe(name);
  });

  it.each<[string, Readonly<Record<string, unknown>>]>([
    ['a javascript: URL', { url: 'javascript:alert(1)' }],
    ['another host', { url: 'https://example.com/AbCd1234' }],
    ['a FIDE ID of 0', { whiteFideId: 0 }],
    ['a negative FIDE ID', { blackFideId: -5 }],
    ['a FIDE ID of ten digits', { whiteFideId: 1_000_000_000 }],
    ['a fractional FIDE ID', { whiteFideId: 1.5 }],
    ['no FIDE ID', { whiteFideId: null, blackFideId: null }],
    ['the same FIDE ID on both sides', { blackFideId: 100 }],
    ['a date that does not exist', { date: '2025-02-30' }],
    ['a date in another form', { date: '2025.01.05' }],
    ['a partial date', { date: '2025-1-5' }],
    ['a result that does not exist', { result: '2-0' }],
    ['a blank name', { white: '   ' }],
    ['a name over the limit', { black: 'x'.repeat(BROADCAST_TEXT_MAX + 1) }],
    ['a control character in a name', { white: 'A\u0000B' }],
    ['a line break in the event', { event: 'A\nB' }],
    ['a control character in the opening', { opening: 'A\u007fB' }],
    ['a control character in the ECO', { eco: 'B9\u00070' }],
  ])('refuses %s', (_, overrides) => {
    const parsed = broadcastGameSchema.safeParse({ ...record(), ...overrides });
    expect(parsed.success).toBe(false);
    const messages = parsed.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      // Message-catalogue keys only (CLAUDE.md); a FIDE ID keeps its own.
      expect([BROADCAST_GAME_ISSUE, 'fide.idInvalid']).toContain(message);
    }
  });
});
