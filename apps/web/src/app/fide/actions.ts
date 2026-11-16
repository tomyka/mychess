'use server';

// The FIDE ID search's actions (#316), and the adding of a Lichess
// broadcast by its link (#349). Both are POSTs, so the searched ID
// travels in the body, never in a URL a log or a Referer could keep. Each
// authenticates, then hands the untrusted input to the use case, which
// parses it and counts the start against the account's rate limit.
import {
  addBroadcastLink,
  type BroadcastLinkState,
} from '../../server/broadcast-link';
import {
  pollFideSearch,
  startFideSearch,
  type FidePollState,
  type FideSearchState,
} from '../../server/fide-search';
import { requireOnboarded } from '../../server/session';

/** Starts a search for the FIDE ID in the form's `fideId` field. */
export async function startFideSearchAction(
  _previous: FideSearchState,
  form: FormData,
): Promise<FideSearchState> {
  const account = await requireOnboarded();
  return startFideSearch(account.id, form.get('fideId'), new Date());
}

/** The progress of the started search `token` names; not rate limited. */
export async function pollFideSearchAction(
  token: unknown,
): Promise<FidePollState> {
  const account = await requireOnboarded();
  return pollFideSearch(account.id, token, new Date());
}

/**
 * Adds the Lichess broadcast the form's `link` field links to (#349,
 * R-197); the use case parses it and counts it against the account's
 * daily limit.
 */
export async function addBroadcastLinkAction(
  _previous: BroadcastLinkState,
  form: FormData,
): Promise<BroadcastLinkState> {
  const account = await requireOnboarded();
  return addBroadcastLink(account.id, form.get('link'), new Date());
}
