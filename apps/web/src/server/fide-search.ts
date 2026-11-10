/**
 * The FIDE ID search's use cases (#316, spec decisions 4 to 7): start a
 * search, then poll its progress while months are being indexed.
 *
 * Starting parses the ID (the domain's fideId), counts the search against
 * the account's rate limit before any database or outbound work, reads the
 * 12 newest months and the player, and answers from the index alone: the
 * months not ready are handed to the background runner, never waited for.
 * The answer carries a signed token (fide-search-token.ts) the page polls;
 * a poll is not counted, and can only follow the search its token names.
 *
 * Each month's display comes from the domain's next action at `now`, never
 * from its stored state: use is ready, process and wait are waiting, and
 * unavailable (failed within the day) is neither.
 */
import {
  broadcastMonthStatuses,
  countRateLimited,
  gamesForFideId,
  type FoundGame,
} from '@mychess/db';
import {
  FIDE_SEARCH_RATE_LIMIT,
  fideId,
  fideSearchRateKey,
  nextBroadcastMonthAction,
  searchMonths,
  type BroadcastMonth,
  type BroadcastMonthAction,
  type FideId,
  type FideIdRefusal,
} from '@mychess/domain';
import type { FidePlayer } from '@mychess/integrations';
import { getDb } from './db';
import { fideServices } from './fide-services';
import { readSearchToken, signSearchToken } from './fide-search-token';

/** Catalogue key of a search whose month list could not be read. */
const SEARCH_UNAVAILABLE = 'fide.searchUnavailable';

type FideSearchRefusalKey =
  | FideIdRefusal['reason']
  | typeof FIDE_SEARCH_RATE_LIMIT.reason
  | typeof SEARCH_UNAVAILABLE;

/** How many of a search's months are in each display state. */
export interface SearchProgress {
  readonly total: number;
  readonly ready: number;
  readonly waiting: number;
  readonly unavailable: number;
}

/** A search as it stands: its months' progress and the games found so far. */
export interface SearchSnapshot {
  readonly progress: SearchProgress;
  readonly games: readonly FoundGame[];
  readonly truncated: boolean;
}

export interface StartedSearch {
  /** What the page polls with (fide-search-token.ts). */
  readonly token: string;
  readonly fideId: FideId;
  /** The result's header; null when Lichess gave no player. */
  readonly player: FidePlayer | null;
  readonly snapshot: SearchSnapshot;
}

export type FideSearchState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'refused';
      readonly refusal: FideSearchRefusalKey;
      readonly limit?: number;
    }
  | { readonly kind: 'started'; readonly search: StartedSearch };

/**
 * A poll's answer: the search's progress; expired, so the page stops; or
 * failed, so the page tries again at its next poll.
 */
export type FidePollState =
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'progress'; readonly snapshot: SearchSnapshot };

/**
 * The one line a failed search logs (security M1): a database error's text
 * can hold the searched ID among its query parameters, so none is written.
 */
const SEARCH_FAILED = 'fide: search failed';

type MonthDisplay = keyof Omit<SearchProgress, 'total'>;

const DISPLAY: Readonly<Record<BroadcastMonthAction, MonthDisplay>> = {
  use: 'ready',
  process: 'waiting',
  wait: 'waiting',
  unavailable: 'unavailable',
};

/**
 * Starts a search of `accountId` for the ID typed as `raw`, at `now`. A
 * failure on the way (the database, say) answers as unavailable.
 */
export async function startFideSearch(
  accountId: string,
  raw: unknown,
  now: Date,
): Promise<FideSearchState> {
  const id = fideId(typeof raw === 'string' ? raw : '');
  if (!id.ok) return { kind: 'refused', refusal: id.refusal.reason };
  try {
    return await startParsed(accountId, id.value, now);
  } catch {
    console.error(SEARCH_FAILED);
    return { kind: 'refused', refusal: SEARCH_UNAVAILABLE };
  }
}

/** Starts the search for the parsed `id`, counted first. */
async function startParsed(
  accountId: string,
  id: FideId,
  now: Date,
): Promise<FideSearchState> {
  const limited = await countRateLimited(
    getDb(),
    fideSearchRateKey(accountId),
    FIDE_SEARCH_RATE_LIMIT,
    now,
  );
  if (!limited.ok) {
    const { reason, limit } = limited.refusal;
    return { kind: 'refused', refusal: reason, limit };
  }
  const { sources, secret } = fideServices();
  const months = await sources.months().then(searchMonths, () => null);
  if (months === null) return { kind: 'refused', refusal: SEARCH_UNAVAILABLE };
  const [player, snapshot] = await Promise.all([
    sources.player(id),
    snapshotOf(id, months, now),
  ]);
  const token = signSearchToken(secret, { accountId, fideId: id, months }, now);
  return { kind: 'started', search: { token, fideId: id, player, snapshot } };
}

/**
 * The progress of the search `token` names, for `accountId`, at `now`; a
 * failure on the way answers as failed, for the page to poll again.
 */
export async function pollFideSearch(
  accountId: string,
  token: unknown,
  now: Date,
): Promise<FidePollState> {
  const search = readSearchToken(fideServices().secret, token, accountId, now);
  if (!search.ok) return { kind: 'expired' };
  const { fideId: id, months } = search.value;
  try {
    return { kind: 'progress', snapshot: await snapshotOf(id, months, now) };
  } catch {
    console.error(SEARCH_FAILED);
    return { kind: 'failed' };
  }
}

/**
 * The search for `id` over `months` at `now`: the months the runner should
 * process are handed to it, unawaited; the games come from the ready ones.
 */
async function snapshotOf(
  id: FideId,
  months: readonly BroadcastMonth[],
  now: Date,
): Promise<SearchSnapshot> {
  const db = getDb();
  const actions = (await broadcastMonthStatuses(db, months)).map(
    ({ month, status }) => ({
      month,
      action: nextBroadcastMonthAction(status, now),
    }),
  );
  fideServices().runner.need(monthsTo('process', actions));
  const found = await gamesForFideId(db, id, monthsTo('use', actions));
  return {
    progress: progressOf(actions.map(({ action }) => DISPLAY[action])),
    games: found.games,
    truncated: found.truncated,
  };
}

function monthsTo(
  action: BroadcastMonthAction,
  actions: readonly {
    readonly month: BroadcastMonth;
    readonly action: BroadcastMonthAction;
  }[],
): BroadcastMonth[] {
  return actions.filter((a) => a.action === action).map((a) => a.month);
}

function progressOf(displays: readonly MonthDisplay[]): SearchProgress {
  const count = (display: MonthDisplay) =>
    displays.filter((d) => d === display).length;
  return {
    total: displays.length,
    ready: count('ready'),
    waiting: count('waiting'),
    unavailable: count('unavailable'),
  };
}
