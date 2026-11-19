// The Lichess broadcast API answers the E2E app reads instead of lichess.org
// (#349): with the fixture directory set (broadcast-fixture.ts says when the
// app uses it), the app's fixture fetch
// (src/server/broadcast-fixture-fetch.ts) serves `by-<account>-<page>.json`,
// `tour-<tourId>.json` and `tour-<tourId>.pgn` from e2e/fixtures/broadcast, beside the month dumps. Every name, id and FIDE ID
// is invented; the tournaments are dated in the fixture's months (2001), so
// they are in the window those months make and never meet a real one.
//
// The committed files are made from the tournaments below. After changing
// them, regenerate with (Node 24 runs the TypeScript as it is):
//
//   node apps/web/e2e/support/broadcast-api-fixture.ts
//   pnpm exec prettier --write apps/web/e2e/fixtures/broadcast/*.json
//
// community-broadcasts.spec.ts checks the committed files still match: the
// JSON by value (Prettier lays it out), the PGN byte for byte.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the fixture files live, beside the month dumps. */
const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'broadcast');

/** The approved organisers (R-200, domain APPROVED_BROADCAST_ORGANISERS). */
const ORGANISERS = ['vakarinis', 'kesnor7', 'paulauskas'] as const;

interface Tour {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly official: boolean;
  /** Its first and last day, `YYYY-MM-DD`. */
  readonly dates: readonly [string, string];
  readonly rounds: readonly string[];
  /** Rounds not finished yet; every other one is. */
  readonly running?: readonly string[];
}

interface Game {
  readonly roundId: string;
  readonly gameId: string;
  readonly white: string;
  readonly black: string;
  readonly whiteFideId?: number;
  readonly blackFideId?: number;
  readonly date: string;
  readonly result: '1-0' | '0-1' | '1/2-1/2';
  readonly eco: string;
  readonly opening: string;
  readonly moves: string;
}

/**
 * The player of the month dumps' third game (broadcast-fixture.ts,
 * Wint0003), whose games an organiser's community tournament repeats.
 */
export const ORGANISER_PLAYER_FIDE_ID = 90_000_201;

/** An organiser's finished community tournament: the night queues it. */
export const ORGANISER_TOUR: Tour = {
  id: 'SynOrg01',
  name: 'Synthetic Organiser Open',
  slug: 'synthetic-organiser-open',
  official: false,
  dates: ['2001-02-16', '2001-02-17'],
  rounds: ['SynOR001', 'SynOR002'],
};

/**
 * The same organiser's official tournament in a dump month: the dumps hold
 * it, so the night leaves it alone (spec decision 2) and has no file of it.
 */
const OFFICIAL_TOUR: Tour = {
  id: 'SynOff01',
  name: 'Synthetic Official Championship',
  slug: 'synthetic-official-championship',
  official: true,
  dates: ['2001-01-05', '2001-01-06'],
  rounds: ['SynOF001'],
};

/**
 * The organiser's community tournament with a round still to play: the
 * night leaves it until it has finished, so Lichess is not asked about it.
 */
const RUNNING_TOUR: Tour = {
  id: 'SynRun01',
  name: 'Synthetic Running Cup',
  slug: 'synthetic-running-cup',
  official: false,
  dates: ['2001-02-20', '2001-02-21'],
  rounds: ['SynRR001', 'SynRR002'],
  running: ['SynRR002'],
};

/** Every fixture tournament the index may queue, for the journeys' reset. */
export const FIXTURE_TOUR_IDS = [
  ORGANISER_TOUR.id,
  OFFICIAL_TOUR.id,
  RUNNING_TOUR.id,
] as const;

const ORGANISER_GAMES: readonly Game[] = [
  // The community copy of the 2001-02 dump's Wint0003: another link, the
  // same day, players and result.
  {
    roundId: 'SynOR001',
    gameId: 'SynOG001',
    white: 'Svetimas, Linas',
    black: 'Pasalinis, Algis',
    whiteFideId: ORGANISER_PLAYER_FIDE_ID,
    blackFideId: 90_000_202,
    date: '2001-02-16',
    result: '1-0',
    eco: 'A04',
    opening: 'Zukertort Opening',
    moves: '1. Nf3 d5',
  },
  {
    roundId: 'SynOR002',
    gameId: 'SynOG002',
    white: 'Naujokas, Karolis',
    black: 'Svetimas, Linas',
    whiteFideId: 90_000_203,
    blackFideId: ORGANISER_PLAYER_FIDE_ID,
    date: '2001-02-17',
    result: '0-1',
    eco: 'B07',
    opening: 'Pirc Defense',
    moves: '1. e4 d6 2. d4 Nf6',
  },
];

const instant = (day: string): number => Date.parse(`${day}T09:00:00Z`);

/** A tour as Lichess's JSON gives it; an official one has a tier. */
function tourJson(tour: Tour): Record<string, unknown> {
  return {
    id: tour.id,
    name: tour.name,
    slug: tour.slug,
    createdAt: instant(tour.dates[0]) - 86_400_000,
    dates: tour.dates.map(instant),
    ...(tour.official ? { tier: 4 } : {}),
  };
}

const isFinished = (tour: Tour, round: string): boolean =>
  !(tour.running ?? []).includes(round);

/** `GET /api/broadcast/{tourId}`: the tour with its rounds. */
function tourDetailJson(tour: Tour): Record<string, unknown> {
  return {
    tour: tourJson(tour),
    rounds: tour.rounds.map((id, n) => ({
      id,
      name: `Round ${String(n + 1)}`,
      slug: `round-${String(n + 1)}`,
      startsAt: instant(tour.dates[0]) + n * 86_400_000,
      ...(isFinished(tour, id) ? { finished: true } : {}),
    })),
  };
}

/** A listed tour; one with a round to play lists that round. */
function listedJson(tour: Tour): Record<string, unknown> {
  const running = tour.running?.[0];
  return {
    tour: tourJson(tour),
    ...(running === undefined ? {} : { round: { id: running } }),
  };
}

/** A round's game link, as Lichess's tour PGN gives it. */
function tourGameUrl(tour: Tour, game: Game): string {
  const round = tour.rounds.indexOf(game.roundId) + 1;
  return `https://lichess.org/broadcast/${tour.slug}/round-${String(round)}/${game.roundId}/${game.gameId}`;
}

/** `GET /api/broadcast/{tourId}.pgn`: every game with its headers. */
function tourPgn(tour: Tour, games: readonly Game[]): string {
  return games
    .map((game) => {
      const round = tour.rounds.indexOf(game.roundId) + 1;
      const tags: [string, string | undefined][] = [
        ['Event', `${tour.name} | Round ${String(round)}`],
        ['Site', 'Synthetic Hall'],
        ['Date', game.date.replaceAll('-', '.')],
        ['Round', String(round)],
        ['White', game.white],
        ['Black', game.black],
        ['Result', game.result],
        ['WhiteFideId', game.whiteFideId?.toString()],
        ['BlackFideId', game.blackFideId?.toString()],
        ['ECO', game.eco],
        ['Opening', game.opening],
        ['BroadcastName', tour.name],
        ['GameURL', tourGameUrl(tour, game)],
      ];
      const headers = tags
        .filter((tag): tag is [string, string] => tag[1] !== undefined)
        .map(([name, value]) => `[${name} "${value}"]`);
      return `${headers.join('\n')}\n\n${game.moves} ${game.result}\n\n`;
    })
    .join('');
}

const json = (value: unknown): Uint8Array =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

const page = (tours: readonly Tour[]): Uint8Array =>
  json({ currentPageResults: tours.map(listedJson), nextPage: null });

/**
 * The API's fixture files by name: each organiser's first page (only
 * `paulauskas` lists tournaments), and the detail and PGN of the one
 * tournament the night queues and the runner fetches.
 */
export function apiFixtureFiles(): ReadonlyMap<string, Uint8Array> {
  const listed: Record<(typeof ORGANISERS)[number], readonly Tour[]> = {
    vakarinis: [],
    kesnor7: [],
    paulauskas: [RUNNING_TOUR, ORGANISER_TOUR, OFFICIAL_TOUR],
  };
  const files = new Map<string, Uint8Array>();
  for (const organiser of ORGANISERS) {
    files.set(`by-${organiser}-1.json`, page(listed[organiser]));
  }
  files.set(
    `tour-${ORGANISER_TOUR.id}.json`,
    json(tourDetailJson(ORGANISER_TOUR)),
  );
  files.set(
    `tour-${ORGANISER_TOUR.id}.pgn`,
    Buffer.from(tourPgn(ORGANISER_TOUR, ORGANISER_GAMES), 'utf8'),
  );
  return files;
}

/** How a community game reads on the page, its result from `fideId`'s side. */
export interface CommunityGame {
  readonly date: string;
  readonly event: string;
  readonly opponent: string;
  readonly opponentFideId: number | undefined;
  readonly colour: 'white' | 'black';
  readonly outcome: 'win' | 'draw' | 'loss';
  readonly eco: string;
  /** The Lichess opening name; the page shows it within its family. */
  readonly opening: string;
  readonly url: string;
}

const OUTCOME = {
  '1-0': { white: 'win', black: 'loss' },
  '0-1': { white: 'loss', black: 'win' },
  '1/2-1/2': { white: 'draw', black: 'draw' },
} as const;

function asSeenBy(fideId: number, tour: Tour, game: Game): CommunityGame {
  const colour = game.whiteFideId === fideId ? 'white' : 'black';
  return {
    date: game.date,
    event: tour.name,
    opponent: colour === 'white' ? game.black : game.white,
    opponentFideId: colour === 'white' ? game.blackFideId : game.whiteFideId,
    colour,
    outcome: OUTCOME[game.result][colour],
    eco: game.eco,
    opening: game.opening,
    url: tourGameUrl(tour, game),
  };
}

/**
 * The organiser tournament's games of ORGANISER_PLAYER_FIDE_ID, newest
 * first: the community copy of the dump's game included, which the page
 * leaves out.
 */
export function organiserGames(): CommunityGame[] {
  return ORGANISER_GAMES.map((game) =>
    asSeenBy(ORGANISER_PLAYER_FIDE_ID, ORGANISER_TOUR, game),
  ).sort((a, b) => b.date.localeCompare(a.date));
}

if (import.meta.main) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [name, bytes] of apiFixtureFiles()) {
    writeFileSync(join(FIXTURE_DIR, name), bytes);
  }
}
