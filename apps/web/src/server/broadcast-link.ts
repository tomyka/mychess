/**
 * Adding a Lichess broadcast by its pasted link (#349, R-197, spec
 * decision 4), for any signed-in account.
 *
 * The link is parsed first (parseBroadcastLink), then counted against the
 * account's daily limit before Lichess is asked anything. A round link is
 * resolved to its tournament, the tournament's detail fetched and the
 * domain asked whether it qualifies as a pasted one (qualifyBroadcastTour);
 * one that does is queued and, when new, handed to the runner. Every
 * refusal is a catalogue key. Without a Lichess token links are refused as
 * not available. Its Lichess calls go in the pacer's paste lane, behind
 * the night's and the runner's, each timed from its turn, and the whole
 * paste, its wait in the queue included, is bounded by PASTE_WAIT_MS. Who pasted a tournament is not kept (broadcast-tours.ts).
 */
import { countRateLimited } from '@mychess/db';
import {
  BROADCAST_LINK_RATE_LIMIT,
  broadcastLinkRateKey,
  broadcastWindow,
  ok,
  parseBroadcastLink,
  qualifyBroadcastTour,
  type BroadcastLink,
  type BroadcastLinkRefusal,
  type BroadcastTourRefusal,
} from '@mychess/domain';
import {
  LICHESS_BROADCAST_REFUSALS,
  lichessBroadcastTour,
  lichessBroadcastTourOfRound,
  type LichessApi,
  type LichessBroadcastRefusal,
  type LichessBroadcastResult,
} from '@mychess/integrations';
import { tourCandidate } from './broadcast-candidate';
import type { CommunityBroadcasts } from './broadcast-community';
import { getDb } from './db';
import { fideServices } from './fide-services';

/**
 * How long a paste may take in all, its wait in the pacer's queue
 * included: the paste lane goes behind the night's calls and a 429 pause,
 * so without it the page could say "Adding…" for minutes.
 */
export const PASTE_WAIT_MS = 30_000;

/** Catalogue key of a link that cannot be added right now. */
const UNAVAILABLE = 'fide.broadcastLinkUnavailable';

/** Catalogue key of a tournament or round Lichess does not know. */
const NOT_FOUND = 'fide.tourNotFound';

type BroadcastLinkRefusalKey =
  | BroadcastLinkRefusal['reason']
  | BroadcastTourRefusal['reason']
  | typeof BROADCAST_LINK_RATE_LIMIT.reason
  | typeof UNAVAILABLE
  | typeof NOT_FOUND;

export type BroadcastLinkState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'refused';
      readonly refusal: BroadcastLinkRefusalKey;
      readonly limit?: number;
    }
  /** Queued now: its games appear in searches once fetched. */
  | { readonly kind: 'added'; readonly name: string }
  /** Queued already, by a pasted link or an organiser's list. */
  | { readonly kind: 'known'; readonly name: string };

const refused = (refusal: BroadcastLinkRefusalKey): BroadcastLinkState => ({
  kind: 'refused',
  refusal,
});

/**
 * Adds the broadcast `raw` links to, for `accountId` at `now`. Its
 * Lichess calls share `signal`, PASTE_WAIT_MS from the start unless a
 * test passes its own; once it aborts, a call still queued is dropped. A
 * failure on the way (the database, or that abort) answers as not
 * available.
 */
export async function addBroadcastLink(
  accountId: string,
  raw: unknown,
  now: Date,
  signal: AbortSignal = AbortSignal.timeout(PASTE_WAIT_MS),
): Promise<BroadcastLinkState> {
  const link = parseBroadcastLink(typeof raw === 'string' ? raw : '');
  if (!link.ok) return refused(link.refusal.reason);
  const { community } = fideServices();
  if (community === null) return refused(UNAVAILABLE);
  try {
    return await addParsed({
      community,
      accountId,
      link: link.value,
      now,
      signal,
    });
  } catch {
    // Nothing more: an error's text could hold the link or the account.
    console.error('fide: broadcast link failed');
    return refused(UNAVAILABLE);
  }
}

/** A paste whose link was parsed, for an account with community broadcasts. */
interface ParsedPaste {
  readonly community: CommunityBroadcasts;
  readonly accountId: string;
  readonly link: BroadcastLink;
  readonly now: Date;
  /** Bounds the paste's Lichess calls, their wait in the queue included. */
  readonly signal: AbortSignal;
}

/** Adds the parsed link, counted first. */
async function addParsed({
  community,
  accountId,
  link,
  now,
  signal,
}: ParsedPaste): Promise<BroadcastLinkState> {
  const limited = await countRateLimited(
    getDb(),
    broadcastLinkRateKey(accountId),
    BROADCAST_LINK_RATE_LIMIT,
    now,
  );
  if (!limited.ok) {
    const { reason, limit } = limited.refusal;
    return { kind: 'refused', refusal: reason, limit };
  }
  const window = broadcastWindow(await fideServices().sources.months());
  if (window === null) return refused(UNAVAILABLE);
  const detail = await tourDetail(community.pasteApi, link, signal);
  if (!detail.ok) return refused(lichessRefusal(detail.refusal));
  const { tour, finished } = detail.value;
  const qualified = qualifyBroadcastTour(
    tourCandidate(tour, finished, { kind: 'pasted' }),
    window,
    now,
  );
  if (!qualified.ok) return refused(qualified.refusal.reason);
  const added = await community.add(qualified.value);
  return { kind: added ? 'added' : 'known', name: qualified.value.name };
}

/** The tournament `link` names, with its rounds; a round's resolved first. */
async function tourDetail(
  api: LichessApi,
  link: BroadcastLink,
  signal: AbortSignal,
) {
  const tourId = await tourIdOf(api, link, signal);
  if (!tourId.ok) return tourId;
  return lichessBroadcastTour(api, tourId.value, signal);
}

async function tourIdOf(
  api: LichessApi,
  link: BroadcastLink,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<string>> {
  if (link.kind === 'tour') return ok(link.tourId);
  const tour = await lichessBroadcastTourOfRound(api, link.roundId, signal);
  return tour.ok ? ok(tour.value.id) : tour;
}

/** What the page says of a Lichess refusal: not found, or not available. */
function lichessRefusal(
  refusal: LichessBroadcastRefusal,
): BroadcastLinkRefusalKey {
  return refusal.reason === LICHESS_BROADCAST_REFUSALS.notFound
    ? NOT_FOUND
    : UNAVAILABLE;
}
