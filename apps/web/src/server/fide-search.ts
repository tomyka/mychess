/**
 * The FIDE ID search's use cases (#316, spec decisions 4 to 7): start a
 * search, then poll its progress while months are being indexed. Built
 * with their dependencies by the services (fide-services.ts).
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
import type {
  BroadcastMonthEntry,
  BroadcastSearchScope,
  FoundGame,
  FoundGames,
} from '@mychess/db';
import {
  FIDE_SEARCH_RATE_LIMIT,
  broadcastWindow,
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
import type { BroadcastRunner } from './broadcast-runner';
import type { BroadcastSources } from './broadcast-sources';
import type { CountRequest } from './count-request';
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

/** The index the search reads, on this process's database. */
export interface SearchStore {
  /** Counts the search against its rate limit (countRateLimited). */
  readonly count: CountRequest;
  /** The months' index states (broadcastMonthStatuses). */
  readonly monthStatuses: (
    months: readonly BroadcastMonth[],
  ) => Promise<BroadcastMonthEntry[]>;
  /** The games of `id` the scope covers (gamesForFideId). */
  readonly games: (
    id: FideId,
    scope: BroadcastSearchScope,
  ) => Promise<FoundGames>;
}

export interface FideSearchDeps {
  readonly store: SearchStore;
  /** Where the months the search needs are handed, unawaited. */
  readonly runner: Pick<BroadcastRunner, 'need'>;
  /** The cached month list and players; a search never refreshes them. */
  readonly sources: Pick<BroadcastSources, 'months' | 'player'>;
  /** Signs the search tokens (fide-search-token.ts). */
  readonly secret: string;
}

export interface FideSearch {
  /**
   * Starts a search of `accountId` for the ID typed as `raw`, at `now`. A
   * failure on the way (the database, say) answers as unavailable.
   */
  readonly start: (
    accountId: string,
    raw: unknown,
    now: Date,
  ) => Promise<FideSearchState>;
  /**
   * The progress of the search `token` names, for `accountId`, at `now`; a
   * failure on the way answers as failed, for the page to poll again.
   */
  readonly poll: (
    accountId: string,
    token: unknown,
    now: Date,
  ) => Promise<FidePollState>;
}

/** The search use cases over `deps` (fide-services.ts builds them). */
export function createFideSearch(deps: FideSearchDeps): FideSearch {
  return {
    async start(accountId, raw, now) {
      const id = fideId(typeof raw === 'string' ? raw : '');
      if (!id.ok) return { kind: 'refused', refusal: id.refusal.reason };
      try {
        return await startParsed(deps, accountId, id.value, now);
      } catch {
        console.error(SEARCH_FAILED);
        return { kind: 'refused', refusal: SEARCH_UNAVAILABLE };
      }
    },
    async poll(accountId, token, now) {
      const search = readSearchToken(deps.secret, token, accountId, now);
      if (!search.ok) return { kind: 'expired' };
      const { fideId: id, months } = search.value;
      try {
        return {
          kind: 'progress',
          snapshot: await snapshotOf(deps, id, months, now),
        };
      } catch {
        console.error(SEARCH_FAILED);
        return { kind: 'failed' };
      }
    },
  };
}

/** Starts the search for the parsed `id`, counted first. */
async function startParsed(
  deps: FideSearchDeps,
  accountId: string,
  id: FideId,
  now: Date,
): Promise<FideSearchState> {
  const limited = await deps.store.count(
    fideSearchRateKey(accountId),
    FIDE_SEARCH_RATE_LIMIT,
    now,
  );
  if (!limited.ok) {
    const { reason, limit } = limited.refusal;
    return { kind: 'refused', refusal: reason, limit };
  }
  const months = await deps.sources.months().then(searchMonths, () => null);
  if (months === null) return { kind: 'refused', refusal: SEARCH_UNAVAILABLE };
  const [player, snapshot] = await Promise.all([
    deps.sources.player(id),
    snapshotOf(deps, id, months, now),
  ]);
  const token = signSearchToken(
    deps.secret,
    { accountId, fideId: id, months },
    now,
  );
  return { kind: 'started', search: { token, fideId: id, player, snapshot } };
}

/**
 * The search for `id` over `months` at `now`: the months the runner should
 * process are handed to it, unawaited; the games come from the ready ones
 * and from the tournaments fetched in their window (#349); the query
 * leaves out a community copy of an official game (preferOfficialCopies's
 * rule) before its limit.
 */
async function snapshotOf(
  deps: FideSearchDeps,
  id: FideId,
  months: readonly BroadcastMonth[],
  now: Date,
): Promise<SearchSnapshot> {
  const actions = (await deps.store.monthStatuses(months)).map(
    ({ month, status }) => ({
      month,
      action: nextBroadcastMonthAction(status, now),
    }),
  );
  deps.runner.need(monthsTo('process', actions));
  const found = await deps.store.games(id, {
    months: monthsTo('use', actions),
    window: broadcastWindow(months),
  });
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
