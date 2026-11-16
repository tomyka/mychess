'use server';

// The FIDE ID search's actions (#316). Both are POSTs, so the searched ID
// travels in the body, never in a URL a log or a Referer could keep. Each
// authenticates, then hands the untrusted input to the use case the
// services built (fide-services.ts), which parses it and counts it against
// the account's rate limit.
import type { FidePollState, FideSearchState } from '../../server/fide-search';
import { fideServices } from '../../server/fide-services';
import { requireOnboarded } from '../../server/session';

/** Starts a search for the FIDE ID in the form's `fideId` field. */
export async function startFideSearchAction(
  _previous: FideSearchState,
  form: FormData,
): Promise<FideSearchState> {
  const account = await requireOnboarded();
  return fideServices().search.start(
    account.id,
    form.get('fideId'),
    new Date(),
  );
}

/** The progress of the started search `token` names; not rate limited. */
export async function pollFideSearchAction(
  token: unknown,
): Promise<FidePollState> {
  const account = await requireOnboarded();
  return fideServices().search.poll(account.id, token, new Date());
}
