/**
 * The months Lichess has published a broadcast dump for (#316, R-183), read
 * from https://database.lichess.org/broadcast/list.txt.
 */
import { getOk, readCappedText, type Fetch } from './http';
import { MONTH_FORMAT } from './month-format';

/** The published dump list; the only URL this module fetches. */
export const BROADCAST_LIST_URL =
  'https://database.lichess.org/broadcast/list.txt';

/** The most bytes of the dump list read (security requirements, task 1). */
const LIST_MAX_BYTES = 64 * 1024;

/** A monthly dump's file name, its month captured. */
const DUMP_FILE_NAME = new RegExp(
  `^lichess_db_broadcast_(${MONTH_FORMAT})\\.pgn\\.zst$`,
);

/**
 * The months of the published broadcast dumps as `YYYY-MM`, newest first,
 * each once. Only the month is taken from a line's file name: the URL a
 * line holds is never returned or fetched, the dump URL is rebuilt from the
 * month (broadcastDumpUrl). Lines that do not name a monthly dump are
 * skipped.
 */
export async function broadcastMonths(
  fetch: Fetch,
  signal: AbortSignal,
): Promise<string[]> {
  const response = await getOk(fetch, BROADCAST_LIST_URL, signal);
  const text = await readCappedText(
    response,
    LIST_MAX_BYTES,
    signal,
    'the broadcast dump list',
  );
  const months = text.split('\n').flatMap((line) => {
    const month = DUMP_FILE_NAME.exec(fileName(line))?.[1];
    return month === undefined ? [] : [month];
  });
  return [...new Set(months)].sort().reverse();
}

function fileName(line: string): string {
  const path = line.trim();
  return path.slice(path.lastIndexOf('/') + 1);
}
