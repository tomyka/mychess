// Synthetic Lichess broadcast dumps (#316) for the component and feature
// suites: small PGN months, zstd-compressed in the test, served by a fake
// fetch, so no test reaches the network. Names and FIDE IDs are invented.
import { broadcastDumpUrl, type Fetch } from '@mychess/integrations';
import { zstdCompressSync } from 'node:zlib';

/** The searched player of the fixtures. */
export const RUTA_FIDE_ID = 90_000_001;

export interface FixtureGame {
  readonly white: string;
  readonly black: string;
  readonly whiteFideId?: number;
  readonly blackFideId?: number;
  readonly date: string;
  readonly result: string;
  readonly event: string;
  readonly code: string;
}

/** One game of a dump, its move text with a bracket in a comment. */
function pgnGame(game: FixtureGame): string {
  const tags = [
    ['Event', 'Round 1'],
    ['Date', game.date.replaceAll('-', '.')],
    ['White', game.white],
    ['Black', game.black],
    ['Result', game.result],
    ...(game.whiteFideId === undefined
      ? []
      : [['WhiteFideId', String(game.whiteFideId)]]),
    ...(game.blackFideId === undefined
      ? []
      : [['BlackFideId', String(game.blackFideId)]]),
    ['ECO', 'B12'],
    ['Opening', 'Caro-Kann Defense: Advance Variation'],
    ['BroadcastName', game.event],
    ['GameURL', `https://lichess.org/broadcast/synthetic/round-1/${game.code}`],
  ];
  const headers = tags.map(
    ([name, value]) => `[${name ?? ''} "${value ?? ''}"]`,
  );
  return `${headers.join('\n')}\n\n1. e4 { [%clk 1:30:00] } c6 2. d4 d5 ${game.result}\n\n`;
}

/** Two games of Rūta's in a month, one as White and one as Black. */
export function rutaMonth(month: string): FixtureGame[] {
  return [
    {
      white: 'Pavyzdyte, Ruta',
      black: 'Testas, Jonas',
      whiteFideId: RUTA_FIDE_ID,
      blackFideId: 90_000_002,
      date: `${month}-14`,
      result: '1-0',
      event: `Synthetic Open ${month}`,
      code: `w${month.replace('-', '')}`,
    },
    {
      white: 'Kitas, Petras',
      black: 'Pavyzdyte, Ruta',
      blackFideId: RUTA_FIDE_ID,
      date: `${month}-15`,
      result: '1/2-1/2',
      event: `Synthetic Open ${month}`,
      code: `b${month.replace('-', '')}`,
    },
  ];
}

/** `games` as one zstd-compressed dump. */
export function compressedDump(games: readonly FixtureGame[]): Uint8Array {
  return zstdCompressSync(Buffer.from(games.map(pgnGame).join(''), 'utf8'));
}

/** A response streaming `bytes` in chunks of `size`, noting a cancel. */
export function dumpResponse(
  bytes: Uint8Array,
  size = 64,
): { readonly response: Response; readonly cancelled: () => boolean } {
  let offset = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

/**
 * A response that sends `first` and then nothing more until cancelled, as
 * a stalled download would; or, with `dripMs`, one more byte every
 * `dripMs` forever, as a download too slow to finish would.
 */
export function stalledResponse(
  first: Uint8Array,
  dripMs?: number,
): { readonly response: Response; readonly cancelled: () => boolean } {
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
      if (dripMs !== undefined) {
        timer = setInterval(() => {
          controller.enqueue(new Uint8Array([0]));
        }, dripMs);
      }
    },
    cancel() {
      cancelled = true;
      clearInterval(timer);
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

export interface DumpServer {
  readonly fetch: Fetch;
  /** The URLs fetched, in order. */
  readonly fetched: string[];
}

/**
 * A fetch serving each month of `dumps` from its dump URL, the answer built
 * afresh per request; any other URL fails, as the network is not there.
 * An answer of `'hang'` never comes, until the request's signal aborts it.
 */
export function dumpServer(
  dumps: Readonly<Record<string, (() => Response) | 'hang'>>,
): DumpServer {
  const fetched: string[] = [];
  const fetch: Fetch = (url, init) => {
    fetched.push(url);
    const month = Object.keys(dumps).find((m) => broadcastDumpUrl(m) === url);
    const answer = month === undefined ? undefined : dumps[month];
    if (answer === undefined) return Promise.reject(new Error('offline'));
    if (answer !== 'hang') return Promise.resolve(answer());
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  };
  return { fetch, fetched };
}
