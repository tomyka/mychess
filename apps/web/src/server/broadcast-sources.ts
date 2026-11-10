/**
 * What a FIDE ID search reads from Lichess at search time (#316, spec
 * decisions 4 and 5), cached in this process's memory only (security
 * requirements, task 4): the published dump months for an hour, each FIDE
 * player for a day. The dumps themselves are only read by the runner.
 */
import { broadcastMonthSchema, type BroadcastMonth } from '@mychess/domain';
import {
  broadcastMonths,
  lichessFidePlayer,
  type Fetch,
  type FidePlayer,
} from '@mychess/integrations';

/** How long the month list is reused: an hour (spec decision 4). */
export const MONTHS_CACHE_MS = 60 * 60_000;

/** How long a FIDE player is reused: a day (spec decision 5). */
export const PLAYER_CACHE_MS = 24 * 60 * 60_000;

/** The most players kept, so the cache cannot grow without bound. */
export const PLAYER_CACHE_SIZE = 1000;

/** How long one request to Lichess may take. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface BroadcastSources {
  /** The published dump months, newest first; fails when unreadable. */
  months(): Promise<BroadcastMonth[]>;
  /** The FIDE player with `id`; null when Lichess does not give one. */
  player(id: number): Promise<FidePlayer | null>;
}

export interface BroadcastSourcesDeps {
  readonly fetch: Fetch;
  readonly clock: () => Date;
}

interface Cached<T> {
  readonly value: T;
  readonly at: number;
}

/** Sources over `fetch`, with caches that start empty. */
export function createBroadcastSources({
  fetch,
  clock,
}: BroadcastSourcesDeps): BroadcastSources {
  let list: Cached<Promise<BroadcastMonth[]>> | undefined;
  const players = new Map<number, Cached<FidePlayer | null>>();
  const fresh = (entry: Cached<unknown> | undefined, ttl: number) =>
    entry !== undefined && clock().getTime() - entry.at < ttl;

  return {
    months() {
      if (list === undefined || !fresh(list, MONTHS_CACHE_MS)) {
        const value = publishedMonths(fetch);
        const entry = { value, at: clock().getTime() };
        list = entry;
        // A failed read is not kept: the next search asks again.
        value.catch(() => {
          if (list === entry) list = undefined;
        });
      }
      return list.value;
    },
    async player(id) {
      const cached = players.get(id);
      if (cached !== undefined && fresh(cached, PLAYER_CACHE_MS)) {
        return cached.value;
      }
      const found = await knownPlayer(fetch, id);
      if (found === undefined) return null;
      remember(players, id, { value: found, at: clock().getTime() });
      return found;
    },
  };
}

async function publishedMonths(fetch: Fetch): Promise<BroadcastMonth[]> {
  const months = await broadcastMonths(
    fetch,
    AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  );
  return months.flatMap((month) => {
    const parsed = broadcastMonthSchema.safeParse(month);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The player Lichess gives for `id`, null when it gives none (not found, or
 * an answer that does not parse), or undefined when the request failed, so
 * the next search asks again. The header is optional (spec decision 5), so
 * a failure only drops it; it is not logged, as its cause would sit beside
 * the searched ID.
 */
async function knownPlayer(
  fetch: Fetch,
  id: number,
): Promise<FidePlayer | null | undefined> {
  try {
    const player = await lichessFidePlayer(
      fetch,
      id,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    );
    return player.ok ? player.value : null;
  } catch {
    return undefined;
  }
}

/** Keeps `entry` as the newest, dropping the oldest past the size cap. */
function remember<K, V>(cache: Map<K, V>, key: K, entry: V): void {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size <= PLAYER_CACHE_SIZE) return;
  const oldest = cache.keys().next();
  if (oldest.done !== true) cache.delete(oldest.value);
}
