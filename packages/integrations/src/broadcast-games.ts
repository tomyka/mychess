/**
 * The game headers of a Lichess broadcast dump (#316, spec decision 1), read
 * from its PGN text as it streams. Move text is skipped, never collected.
 *
 * A record maps 1:1 onto the domain's BroadcastGameInput
 * (`@mychess/domain` broadcast-game.ts). This package may not import the
 * domain, so only the checks the task 1 security requirements ask of the
 * parser are repeated here; the database re-checks every record with the
 * domain's broadcastGameSchema before it is written.
 */
import { cappedLines, type CappedLine } from './capped-lines';
import { recordOf, type BroadcastGameRecord } from './broadcast-record';

export type { BroadcastGameRecord } from './broadcast-record';

/** The caps of the header parser (security requirements, task 1). */
export const BROADCAST_GAME_LIMITS = {
  /** The longest header line read; a longer one skips its game. */
  headerLineChars: 1024,
  /** The most headers a game may have; more skip the game. */
  headersPerGame: 64,
  /** The most games a month's dump may hold; more fail the whole month. */
  gamesPerMonth: 200_000,
  /** The most characters a name, event, ECO or opening keeps. */
  textChars: 200,
} as const;

/** A whole PGN tag pair line: `[Name "value"]`, quotes and `\` escaped. */
const TAG_PAIR = /^\[([A-Za-z0-9_]+) "((?:[^"\\]|\\.)*)"\]$/;

/** The start of a tag pair: tells a game's first header from move text. */
const TAG_PAIR_START = /^\[[A-Za-z0-9_]+ "/;

/**
 * The headers of each game of a dump's PGN text, read on demand, so the
 * reader's pace holds the download back. A game is yielded when it has a
 * Lichess GameURL, one of the four results, a White, a Black, an event (the
 * BroadcastName, or else the Event) and a valid FIDE ID on at least one
 * side, not the same on both; other games, and games with a header line that is too long or not
 * a tag pair, or too many headers, are skipped. Fails past
 * BROADCAST_GAME_LIMITS.gamesPerMonth games.
 */
export async function* broadcastGames(
  text: AsyncIterable<string>,
): AsyncGenerator<BroadcastGameRecord> {
  const reader = new DumpReader();
  for await (const line of cappedLines(
    text,
    BROADCAST_GAME_LIMITS.headerLineChars,
  )) {
    const ended = reader.read(line);
    if (ended !== undefined) yield* keptRecord(ended);
  }
  const last = reader.end();
  if (last !== undefined) yield* keptRecord(last);
}

function keptRecord(game: GameHeaders): BroadcastGameRecord[] {
  if (game.malformed) return [];
  const record = recordOf(game.values, BROADCAST_GAME_LIMITS.textChars);
  return record === null ? [] : [record];
}

/** One game's header lines as read. */
class GameHeaders {
  readonly values = new Map<string, string>();
  malformed = false;
  private count = 0;

  add(line: CappedLine): void {
    this.count += 1;
    const tag = line.truncated ? null : TAG_PAIR.exec(line.text);
    if (
      tag === null ||
      this.count > BROADCAST_GAME_LIMITS.headersPerGame ||
      this.malformed
    ) {
      this.malformed = true;
      return;
    }
    const [, name = '', value = ''] = tag;
    if (!this.values.has(name)) this.values.set(name, unescaped(value));
  }
}

/**
 * Splits the lines of a dump into games: a game's headers run from a tag
 * pair to the first line that is not one. In move text only a whole tag
 * pair start begins the next game, so a bracket inside a comment does not.
 */
class DumpReader {
  private game: GameHeaders | undefined;
  private inMoves = false;
  private games = 0;

  /** Reads `line`; returns the game it ended, if any. */
  read(line: CappedLine): GameHeaders | undefined {
    if (this.isHeader(line)) {
      this.openGame().add(line);
      return undefined;
    }
    const ended = this.end();
    this.inMoves = line.text.trim() !== '' || line.truncated;
    return ended;
  }

  /** Ends the game being read, if any, and returns it. */
  end(): GameHeaders | undefined {
    const game = this.game;
    this.game = undefined;
    return game;
  }

  private isHeader(line: CappedLine): boolean {
    if (this.game !== undefined || !this.inMoves) {
      return line.text.startsWith('[');
    }
    return TAG_PAIR_START.test(line.text);
  }

  /** The game being read, or a new one when none is. */
  private openGame(): GameHeaders {
    if (this.game !== undefined) return this.game;
    this.games += 1;
    if (this.games > BROADCAST_GAME_LIMITS.gamesPerMonth) {
      throw new Error(
        `the broadcast dump has more than ${String(BROADCAST_GAME_LIMITS.gamesPerMonth)} games`,
      );
    }
    const game = new GameHeaders();
    this.game = game;
    this.inMoves = false;
    return game;
  }
}

function unescaped(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}
