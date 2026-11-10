// The Lichess broadcast dumps the E2E app reads instead of
// database.lichess.org (#316): with MYCHESS_ENV=local, the test sign-in on
// and FIDE_DUMP_FIXTURE_DIR naming e2e/fixtures/broadcast, the app's fixture
// fetch (src/server/broadcast-fixture-fetch.ts) serves list.txt and each
// month's lichess_db_broadcast_<YYYY-MM>.pgn.zst from there. Every name and
// FIDE ID is invented; the months are long before Lichess had broadcast
// dumps, so they never meet a real month in a developer's database.
//
// The committed files are made from the games below. After changing them,
// regenerate with (Node 24 runs the TypeScript as it is):
//
//   node apps/web/e2e/support/broadcast-fixture.ts
//
// fide-search.spec.ts checks the committed files still match.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

/** Where the fixture files live; playwright.config.ts and e2e.yml point the app at it. */
export const BROADCAST_FIXTURE_DIR = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'broadcast',
);

/** The searched player's invented FIDE ID. */
export const SEARCHED_FIDE_ID = 90_000_101;

/** The listed months, newest first; every one has its dump file. */
export const FIXTURE_MONTHS = ['2001-02', '2001-01'] as const;

type Month = (typeof FIXTURE_MONTHS)[number];

interface DumpGame {
  readonly month: Month;
  readonly white: string;
  readonly black: string;
  readonly whiteFideId?: number;
  readonly blackFideId?: number;
  readonly date: string;
  readonly result: '1-0' | '0-1' | '1/2-1/2';
  readonly eco: string;
  readonly opening: string;
  readonly moves: string;
  readonly event: string;
  readonly code: string;
}

const SEARCHED = 'Bandomasis, Vardas';
const WINTER = 'Synthetic Winter Open';
const NEW_YEAR = 'Synthetic New Year Cup';

/**
 * The dumps' games: four of the searched player's, one between two other
 * players, and one with no FIDE ID at all, which the index skips.
 */
const GAMES: readonly DumpGame[] = [
  {
    month: '2001-02',
    white: 'Kitas, Petras',
    black: SEARCHED,
    blackFideId: SEARCHED_FIDE_ID,
    date: '2001-02-15',
    result: '0-1',
    eco: 'B12',
    opening: 'Caro-Kann Defense: Advance Variation',
    moves: '1. e4 c6 2. d4 d5 3. e5',
    event: WINTER,
    code: 'Wint0002',
  },
  {
    month: '2001-02',
    white: SEARCHED,
    black: 'Testas, Jonas',
    whiteFideId: SEARCHED_FIDE_ID,
    blackFideId: 90_000_102,
    date: '2001-02-14',
    result: '1/2-1/2',
    eco: 'C42',
    opening: 'Russian Game',
    moves: '1. e4 e5 2. Nf3 Nf6',
    event: WINTER,
    code: 'Wint0001',
  },
  {
    month: '2001-02',
    white: 'Svetimas, Linas',
    black: 'Pasalinis, Algis',
    whiteFideId: 90_000_201,
    blackFideId: 90_000_202,
    date: '2001-02-16',
    result: '1-0',
    eco: 'A04',
    opening: 'Zukertort Opening',
    moves: '1. Nf3 d5',
    event: WINTER,
    code: 'Wint0003',
  },
  {
    month: '2001-01',
    white: 'Pavyzdys, Tomas',
    black: SEARCHED,
    whiteFideId: 90_000_103,
    blackFideId: SEARCHED_FIDE_ID,
    date: '2001-01-20',
    result: '1-0',
    eco: 'D35',
    opening: "Queen's Gambit Declined: Exchange Variation",
    moves: '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5',
    event: NEW_YEAR,
    code: 'Year0002',
  },
  {
    month: '2001-01',
    white: SEARCHED,
    black: 'Bandyte, Ona',
    whiteFideId: SEARCHED_FIDE_ID,
    blackFideId: 90_000_104,
    date: '2001-01-19',
    result: '1-0',
    eco: 'E60',
    opening: "King's Indian Defense",
    moves: '1. d4 Nf6 2. c4 g6',
    event: NEW_YEAR,
    code: 'Year0001',
  },
  {
    month: '2001-01',
    white: 'Bevardis, Rokas',
    black: 'Bevarde, Ieva',
    date: '2001-01-18',
    result: '1/2-1/2',
    eco: 'A00',
    opening: 'Polish Opening',
    moves: '1. b4 e5',
    event: NEW_YEAR,
    code: 'Year0003',
  },
];

/** The address a month's dump has on database.lichess.org. */
function dumpUrl(month: Month): string {
  return `https://database.lichess.org/broadcast/${dumpFile(month)}`;
}

function dumpFile(month: Month): string {
  return `lichess_db_broadcast_${month}.pgn.zst`;
}

function gameUrl(game: DumpGame): string {
  const slug = game.event.toLowerCase().replaceAll(' ', '-');
  return `https://lichess.org/broadcast/${slug}/round-1/Synth${game.month.slice(5)}/${game.code}`;
}

function pgn(game: DumpGame): string {
  const tags: [string, string | undefined][] = [
    ['Event', `${game.event} | Round 1`],
    ['Site', 'Synthetic Hall'],
    ['Date', game.date.replaceAll('-', '.')],
    ['Round', '1'],
    ['White', game.white],
    ['Black', game.black],
    ['Result', game.result],
    ['WhiteFideId', game.whiteFideId?.toString()],
    ['BlackFideId', game.blackFideId?.toString()],
    ['ECO', game.eco],
    ['Opening', game.opening],
    ['BroadcastName', game.event],
    ['GameURL', gameUrl(game)],
  ];
  const headers = tags
    .filter((tag): tag is [string, string] => tag[1] !== undefined)
    .map(([name, value]) => `[${name} "${value}"]`);
  return `${headers.join('\n')}\n\n${game.moves} ${game.result}\n\n`;
}

/** The fixture directory's files by name: list.txt and each month's dump. */
export function fixtureFiles(): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    [
      'list.txt',
      Buffer.from(`${FIXTURE_MONTHS.map(dumpUrl).join('\n')}\n`, 'utf8'),
    ],
  ]);
  for (const month of FIXTURE_MONTHS) {
    const text = GAMES.filter((game) => game.month === month)
      .map(pgn)
      .join('');
    files.set(dumpFile(month), zstdCompressSync(Buffer.from(text, 'utf8')));
  }
  return files;
}

/** How a found game reads on the page, its result from the searched side. */
export interface ExpectedGame {
  readonly date: string;
  readonly event: string;
  readonly opponent: string;
  readonly opponentFideId: number | undefined;
  readonly colour: 'white' | 'black';
  readonly outcome: 'win' | 'draw' | 'loss';
  readonly opening: string;
  readonly url: string;
}

const OUTCOME = {
  '1-0': { white: 'win', black: 'loss' },
  '0-1': { white: 'loss', black: 'win' },
  '1/2-1/2': { white: 'draw', black: 'draw' },
} as const;

/** The searched player's games, newest first, as the page lists them. */
export function expectedGames(): ExpectedGame[] {
  return GAMES.filter(
    (game) =>
      game.whiteFideId === SEARCHED_FIDE_ID ||
      game.blackFideId === SEARCHED_FIDE_ID,
  )
    .map((game): ExpectedGame => {
      const colour = game.whiteFideId === SEARCHED_FIDE_ID ? 'white' : 'black';
      return {
        date: game.date,
        event: game.event,
        opponent: colour === 'white' ? game.black : game.white,
        opponentFideId:
          colour === 'white' ? game.blackFideId : game.whiteFideId,
        colour,
        outcome: OUTCOME[game.result][colour],
        opening: `${game.eco} ${game.opening}`,
        url: gameUrl(game),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

if (import.meta.main) {
  mkdirSync(BROADCAST_FIXTURE_DIR, { recursive: true });
  for (const [name, bytes] of fixtureFiles()) {
    writeFileSync(join(BROADCAST_FIXTURE_DIR, name), bytes);
  }
}
