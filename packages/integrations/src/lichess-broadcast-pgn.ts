/**
 * A Lichess broadcast tournament's games (#349, spec "Findings"), from
 * `GET /api/broadcast/{tourId}.pgn?clocks=false&comments=false`, read as
 * the PGN streams through the dump's header parser and its caps. Lichess
 * asks that this is downloaded only for finished tournaments, never polled;
 * the caller decides when.
 */
import { ok } from '@mychess/chess';
import { broadcastGames, type BroadcastGameRecord } from './broadcast-games';
import { readBody } from './http';
import {
  checkBroadcastId,
  lichessGet,
  type LichessApi,
  type LichessBroadcastResult,
} from './lichess-broadcast-request';

/**
 * The most bytes of a tournament's PGN read. Without clocks or comments a
 * game is about 1 KB, so this holds tens of thousands of games.
 */
export const LICHESS_BROADCAST_PGN_MAX_BYTES = 32 * 1024 * 1024;

const TOUR_PGN_NAME = 'the broadcast tournament PGN';

/**
 * An opened tournament PGN: its games, read on demand, and the teardown of
 * the download behind them. Close it (or `await using` it) once done,
 * whether or not the games were read.
 */
export interface LichessBroadcastPgn extends AsyncDisposable {
  /** The games the dump parser keeps, as BroadcastGameRecord. */
  readonly games: AsyncIterable<BroadcastGameRecord>;
  /** Stops the download; reading then fails. */
  close(): void;
}

/**
 * Opens the PGN of tournament `tourId`; the refusals of every Lichess
 * broadcast request. Reading the games fails once the PGN passes
 * LICHESS_BROADCAST_PGN_MAX_BYTES, holds more games than the dump parser
 * allows, the PGN is closed, or `signal` is aborted (with its reason); a
 * reader that stops early or reaches the end closes it. Throws for a
 * `tourId` that is no Lichess broadcast ID.
 */
export async function openLichessBroadcastPgn(
  api: LichessApi,
  tourId: string,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<LichessBroadcastPgn>> {
  checkBroadcastId(tourId, 'tour id');
  const url = `https://lichess.org/api/broadcast/${tourId}.pgn?clocks=false&comments=false`;
  const answer = await lichessGet(api, url, signal);
  return answer.ok ? ok(pgnOf(answer.value, signal)) : answer;
}

function pgnOf(response: Response, signal: AbortSignal): LichessBroadcastPgn {
  const body = readBody(
    response,
    LICHESS_BROADCAST_PGN_MAX_BYTES,
    signal,
    TOUR_PGN_NAME,
  );
  const close = (): void => {
    body.cancel(new Error(`${TOUR_PGN_NAME} was closed`));
  };
  return {
    games: broadcastGames(utf8Text(body.chunks)),
    close,
    [Symbol.asyncDispose]: () => {
      close();
      return Promise.resolve();
    },
  };
}

/** `bytes` decoded as UTF-8, a character split between chunks kept whole. */
async function* utf8Text(
  bytes: AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  for await (const chunk of bytes) {
    yield decoder.decode(chunk, { stream: true });
  }
  yield decoder.decode();
}
