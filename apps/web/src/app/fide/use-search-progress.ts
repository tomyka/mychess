import { useEffect, useState } from 'react';
import type {
  FidePollState,
  SearchSnapshot,
  StartedSearch,
} from '../../server/fide-search';
import { pollFideSearchAction } from './actions';

/** How long the page waits between progress polls. */
export const POLL_MS = 5000;

export interface SearchProgressState {
  readonly snapshot: SearchSnapshot;
  /** The token expired: the page stops polling and says so. */
  readonly expired: boolean;
  /** Polls tried, so a failed one still schedules the next. */
  readonly polls: number;
}

/**
 * The started `search` as it stands, polled every POLL_MS while a month is
 * still waiting (spec decision 5): a month unavailable until tomorrow is
 * not waited for. A failed poll is tried again at the next interval; an
 * expired token ends the polling.
 */
export function useSearchProgress(search: StartedSearch): SearchProgressState {
  const [state, setState] = useState<SearchProgressState>({
    snapshot: search.snapshot,
    expired: false,
    polls: 0,
  });
  const polling = !state.expired && state.snapshot.progress.waiting > 0;
  useEffect(() => {
    if (!polling) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      pollFideSearchAction(search.token).then(
        (answer) => {
          if (live) setState((previous) => afterPoll(previous, answer));
        },
        () => {
          if (live) setState((previous) => afterPoll(previous, undefined));
        },
      );
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [polling, state.polls, search.token]);
  return state;
}

/**
 * The state after a poll that answered `answer`; a poll that could not be
 * sent (undefined) or that the server answered as failed is tried again.
 */
function afterPoll(
  previous: SearchProgressState,
  answer: FidePollState | undefined,
): SearchProgressState {
  const polls = previous.polls + 1;
  if (answer === undefined || answer.kind === 'failed') {
    return { ...previous, polls };
  }
  if (answer.kind === 'expired') return { ...previous, expired: true, polls };
  return { snapshot: answer.snapshot, expired: false, polls };
}
