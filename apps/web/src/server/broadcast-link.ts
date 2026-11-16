/**
 * Adding a Lichess broadcast by its pasted link (#349, R-197, spec
 * decision 4), for any signed-in account. Built with its dependencies by
 * the services (fide-services.ts).
 *
 * The link is parsed first (parseBroadcastLink), then counted against the
 * account's daily limit before Lichess is asked anything. The Lichess
 * gateway resolves it to its tournament and describes it, within its own
 * 30 s for a paste (lichess-broadcasts.ts); the domain says whether it
 * qualifies as a pasted one (qualifyBroadcastTour); one that does is
 * queued and, when new, handed to the runner. Every refusal is a catalogue
 * key. Without a Lichess token links are refused as not available. Who
 * pasted a tournament is not kept (broadcast-tours.ts).
 */
import {
  BROADCAST_LINK_RATE_LIMIT,
  broadcastLinkRateKey,
  broadcastWindow,
  parseBroadcastLink,
  qualifyBroadcastTour,
  type BroadcastLink,
  type BroadcastLinkRefusal,
  type BroadcastMonth,
  type BroadcastTourRefusal,
  type QueuedBroadcastTour,
} from '@mychess/domain';
import {
  LICHESS_BROADCAST_REFUSALS,
  type LichessBroadcastRefusal,
} from '@mychess/integrations';
import { tourCandidate } from './broadcast-candidate';
import type { CountRequest } from './count-request';
import type { LichessBroadcasts } from './lichess-broadcasts';

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

/** What a paste needs that only a Lichess token gives. */
interface PasteSide {
  readonly broadcasts: Pick<LichessBroadcasts, 'pastedTour'>;
  /** Queues a tournament and hands a new one to the runner; true if new. */
  readonly add: (tour: QueuedBroadcastTour) => Promise<boolean>;
}

export interface AddBroadcastLinkDeps {
  readonly count: CountRequest;
  /** The published dump months (BroadcastSources.months). */
  readonly months: () => Promise<readonly BroadcastMonth[]>;
  /** None without a Lichess token: every link is then not available. */
  readonly paste: PasteSide | null;
}

/**
 * Adds the broadcast `raw` links to, for `accountId` at `now`. A failure
 * on the way (the database, say) answers as not available.
 */
export type AddBroadcastLink = (
  accountId: string,
  raw: unknown,
  now: Date,
) => Promise<BroadcastLinkState>;

const refused = (refusal: BroadcastLinkRefusalKey): BroadcastLinkState => ({
  kind: 'refused',
  refusal,
});

/** The paste use case over `deps`. */
export function createAddBroadcastLink(
  deps: AddBroadcastLinkDeps,
): AddBroadcastLink {
  return async (accountId, raw, now) => {
    const link = parseBroadcastLink(typeof raw === 'string' ? raw : '');
    if (!link.ok) return refused(link.refusal.reason);
    const { paste } = deps;
    if (paste === null) return refused(UNAVAILABLE);
    try {
      return await addParsed(deps, paste, { accountId, link: link.value, now });
    } catch {
      // Nothing more: an error's text could hold the link or the account.
      console.error('fide: broadcast link failed');
      return refused(UNAVAILABLE);
    }
  };
}

/** A paste whose link was parsed. */
interface ParsedPaste {
  readonly accountId: string;
  readonly link: BroadcastLink;
  readonly now: Date;
}

/** Adds the parsed link, counted first. */
async function addParsed(
  deps: AddBroadcastLinkDeps,
  paste: PasteSide,
  { accountId, link, now }: ParsedPaste,
): Promise<BroadcastLinkState> {
  const limited = await deps.count(
    broadcastLinkRateKey(accountId),
    BROADCAST_LINK_RATE_LIMIT,
    now,
  );
  if (!limited.ok) {
    const { reason, limit } = limited.refusal;
    return { kind: 'refused', refusal: reason, limit };
  }
  const window = broadcastWindow(await deps.months());
  if (window === null) return refused(UNAVAILABLE);
  const detail = await paste.broadcasts.pastedTour(link);
  if (!detail.ok) return refused(lichessRefusal(detail.refusal));
  const { tour, finished } = detail.value;
  const qualified = qualifyBroadcastTour(
    tourCandidate(tour, finished, { kind: 'pasted' }),
    window,
    now,
  );
  if (!qualified.ok) return refused(qualified.refusal.reason);
  const added = await paste.add(qualified.value);
  return { kind: added ? 'added' : 'known', name: qualified.value.name };
}

/** What the page says of a Lichess refusal: not found, or not available. */
function lichessRefusal(
  refusal: LichessBroadcastRefusal,
): BroadcastLinkRefusalKey {
  return refusal.reason === LICHESS_BROADCAST_REFUSALS.notFound
    ? NOT_FOUND
    : UNAVAILABLE;
}
