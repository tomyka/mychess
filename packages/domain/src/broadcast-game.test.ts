import { describe, expect, it } from 'vitest';
import {
  BROADCAST_GAME_ISSUE,
  BROADCAST_RESULTS,
  BROADCAST_TEXT_MAX,
  LICHESS_GAME_URL,
  broadcastGameSchema,
  gameForPlayer,
  groupForPreparation,
  isIndexableGame,
  openingFamily,
  type BroadcastGameInput,
  type BroadcastPairing,
  type PreparationGame,
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

describe('openingFamily (#348, R-189)', () => {
  it.each([
    ['Sicilian Defense: Najdorf Variation', 'Sicilian Defense'],
    ['Sicilian Defense: Najdorf Variation, English Attack', 'Sicilian Defense'],
    ['Russian Game', 'Russian Game'],
    ["  Queen's Gambit Declined  : Exchange", "Queen's Gambit Declined"],
    ['Caro-Kann Defense: Advance: odd', 'Caro-Kann Defense'],
  ])('reads %j as the family %j', (name, family) => {
    expect(openingFamily(name)).toBe(family);
  });

  it.each([[null], [''], ['   '], [': Najdorf Variation'], ['  : x']])(
    'gives no family for %j',
    (name) => {
      expect(openingFamily(name)).toBeNull();
    },
  );
});

describe('groupForPreparation (#348, R-189, R-190)', () => {
  interface Game extends PreparationGame {
    readonly name: string;
  }
  const played = (name: string, over: Partial<PreparationGame> = {}): Game => ({
    name,
    colour: 'white',
    outcome: 'win',
    opening: 'Sicilian Defense: Najdorf Variation',
    date: '2026-10-01',
    ...over,
  });
  const names = (games: readonly Game[]): string[] =>
    games.map((game) => game.name);

  it('gives no section for no games', () => {
    expect(groupForPreparation([])).toEqual([]);
  });

  it('puts the games as White first, then as Black, whatever the order given', () => {
    const sections = groupForPreparation([
      played('b', { colour: 'black' }),
      played('w'),
    ]);
    expect(sections.map((section) => section.colour)).toEqual([
      'white',
      'black',
    ]);
    expect(
      sections.map((section) => names(section.groups[0]?.games ?? [])),
    ).toEqual([['w'], ['b']]);
  });

  it('leaves out a colour with no games', () => {
    const sections = groupForPreparation([played('b', { colour: 'black' })]);
    expect(sections.map((section) => section.colour)).toEqual(['black']);
  });

  it('groups by family, the variations of one family together', () => {
    const [white] = groupForPreparation([
      played('najdorf'),
      played('dragon', { opening: 'Sicilian Defense: Dragon Variation' }),
      played('russian', { opening: 'Russian Game' }),
    ]);
    expect(
      white?.groups.map((group) => [group.family, names(group.games)]),
    ).toEqual([
      ['Sicilian Defense', ['najdorf', 'dragon']],
      ['Russian Game', ['russian']],
    ]);
  });

  it('orders the groups by game count, most first, ties by family name', () => {
    const [white] = groupForPreparation([
      played('r1', { opening: 'Russian Game' }),
      played('s1', { opening: 'Scotch Game' }),
      played('s2', { opening: 'Scotch Game: Classical' }),
      played('e1', { opening: 'English Opening' }),
      played('c1', { opening: 'Caro-Kann Defense' }),
    ]);
    expect(white?.groups.map((group) => group.family)).toEqual([
      'Scotch Game',
      'Caro-Kann Defense',
      'English Opening',
      'Russian Game',
    ]);
  });

  it('puts the games with no opening in one group, last even when it is the largest', () => {
    const [white] = groupForPreparation([
      played('u1', { opening: null }),
      played('u2', { opening: '' }),
      played('u3', { opening: ': Najdorf' }),
      played('s1'),
    ]);
    expect(
      white?.groups.map((group) => [group.family, names(group.games)]),
    ).toEqual([
      ['Sicilian Defense', ['s1']],
      [null, ['u1', 'u2', 'u3']],
    ]);
  });

  it('keeps the unknown group last when it comes first', () => {
    const [white] = groupForPreparation([
      played('s1'),
      played('u1', { opening: null }),
      played('r1', { opening: 'Russian Game' }),
    ]);
    expect(white?.groups.map((group) => group.family)).toEqual([
      'Russian Game',
      'Sicilian Defense',
      null,
    ]);
  });

  it('lists a group newest first, an undated game last, equal dates in the order given', () => {
    const [white] = groupForPreparation([
      played('old', { date: '2026-01-05' }),
      played('undated-1', { date: null }),
      played('new', { date: '2026-10-20' }),
      played('same-a', { date: '2026-05-01' }),
      played('undated-2', { date: null }),
      played('same-b', { date: '2026-05-01' }),
    ]);
    expect(names(white?.groups[0]?.games ?? [])).toEqual([
      'new',
      'same-a',
      'same-b',
      'old',
      'undated-1',
      'undated-2',
    ]);
  });

  it('scores each group from the player’s side, unfinished games apart', () => {
    const sections = groupForPreparation([
      played('w1'),
      played('w2'),
      played('d1', { outcome: 'draw' }),
      played('l1', { outcome: 'loss' }),
      played('u1', { outcome: 'unknown' }),
      played('r1', { opening: 'Russian Game', outcome: 'loss' }),
      played('b1', { colour: 'black', outcome: 'draw' }),
    ]);
    expect(
      sections.map((section) =>
        section.groups.map((group) => [group.family, group.score]),
      ),
    ).toEqual([
      [
        ['Sicilian Defense', { win: 2, draw: 1, loss: 1, unknown: 1 }],
        ['Russian Game', { win: 0, draw: 0, loss: 1, unknown: 0 }],
      ],
      [['Sicilian Defense', { win: 0, draw: 1, loss: 0, unknown: 0 }]],
    ]);
  });

  it('keeps every game it was given, once', () => {
    const games = [
      played('a'),
      played('b', { colour: 'black', opening: null }),
      played('c', { opening: 'Russian Game', date: null }),
      played('d', { colour: 'black' }),
    ];
    const kept = groupForPreparation(games).flatMap((section) =>
      section.groups.flatMap((group) => names(group.games)),
    );
    expect(kept.toSorted()).toEqual(['a', 'b', 'c', 'd']);
  });
});
