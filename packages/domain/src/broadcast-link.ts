/**
 * A pasted Lichess broadcast link (#349, R-197, spec decision 4): which
 * tournament or round it names, before the server asks Lichess anything.
 * Strict on purpose, as the id is put into a Lichess API URL: https only,
 * the host exactly lichess.org with no credentials or port, a path of
 * letters, digits and dashes, and at most BROADCAST_LINK_MAX characters.
 */
import { ok, refuse, type Result } from '@mychess/chess';
import {
  broadcastRoundIdSchema,
  broadcastTourIdSchema,
  type BroadcastRoundId,
  type BroadcastTourId,
} from './broadcast-tour';

/** The longest pasted link read, spaces around it left out. */
export const BROADCAST_LINK_MAX = 500;

/** The message-catalogue key of a link that names no broadcast. */
export const BROADCAST_LINK_REFUSAL = 'fide.broadcastLinkInvalid';

/**
 * What a link names: a tournament (`/broadcast/{tour}/{tourId}`) or a
 * round (`/broadcast/{tour}/{round}/{roundId}`, also with a game id after
 * it). A round id has the tournament id's form.
 */
export type BroadcastLink =
  | { readonly kind: 'tour'; readonly tourId: BroadcastTourId }
  | { readonly kind: 'round'; readonly roundId: BroadcastRoundId };

export interface BroadcastLinkRefusal {
  readonly reason: typeof BROADCAST_LINK_REFUSAL;
}

/**
 * The path after `/broadcast/`, then an optional trailing slash, query or
 * fragment of visible ASCII characters only.
 */
const LINK =
  /^https:\/\/lichess\.org\/broadcast\/([A-Za-z0-9/-]+?)\/?(?:[?#][!-~]*)?$/;

const SLUG = /^[A-Za-z0-9-]+$/;

/** The tournament or round `text` links to, or a refusal. */
export function parseBroadcastLink(
  text: string,
): Result<BroadcastLink, BroadcastLinkRefusal> {
  const link = text.trim();
  const path =
    link.length > BROADCAST_LINK_MAX ? undefined : LINK.exec(link)?.[1];
  const named = path === undefined ? null : linkOfPath(path.split('/'));
  return named === null ? refuse(BROADCAST_LINK_REFUSAL) : ok(named);
}

/**
 * The broadcast `segments` name: a tournament slug and id, or a tournament
 * slug, a round slug and id, and maybe a game id.
 */
function linkOfPath(segments: readonly string[]): BroadcastLink | null {
  const [tourSlug, ...after] = segments;
  if (!isSlug(tourSlug)) return null;
  if (after.length === 1) {
    const tourId = idOf(broadcastTourIdSchema, after[0]);
    return tourId === null ? null : { kind: 'tour', tourId };
  }
  return roundLink(after);
}

/** A round slug and id, and maybe a game id after them. */
function roundLink(segments: readonly string[]): BroadcastLink | null {
  const [roundSlug, id, gameId, ...rest] = segments;
  const roundId = idOf(broadcastRoundIdSchema, id);
  const valid =
    roundId !== null &&
    isSlug(roundSlug) &&
    rest.length === 0 &&
    (gameId === undefined || idOf(broadcastRoundIdSchema, gameId) !== null);
  return valid ? { kind: 'round', roundId } : null;
}

function isSlug(segment: string | undefined): boolean {
  return segment !== undefined && SLUG.test(segment);
}

/** `segment` as an id of `schema`; null when it is no broadcast id. */
function idOf<I>(
  schema: {
    safeParse(input: unknown): { success: true; data: I } | { success: false };
  },
  segment: string | undefined,
): I | null {
  const id = schema.safeParse(segment);
  return id.success ? id.data : null;
}
