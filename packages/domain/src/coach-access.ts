import { ok, refuse, type Result } from '@mychess/chess';

/** Message-catalogue keys; the web answers each with 404 (plan decision 4). */
export const ACCESS_REFUSALS = {
  notLinked: 'access.notLinked',
  notShared: 'access.notShared',
  /** The player forked the assignment: it is their own now (R-155). */
  forked: 'access.forked',
} as const;

export interface AccessRefusal {
  readonly reason: (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS];
}

/** What a coach wants to see of a player. S5 adds assigned repertoires. */
export type CoachSubject =
  | { readonly kind: 'profile' }
  | { readonly kind: 'repertoire'; readonly repertoireId: string };

/** The facts the rule decides on, read fresh on every request (checklist 3). */
export interface CoachAccessFacts {
  /** Is there a Coach link from this coach to this player now? */
  readonly linked: boolean;
  /** This player's repertoires shared with this coach (R-42). */
  readonly sharedRepertoireIds: ReadonlySet<string>;
}

type AccessResult = Result<undefined, AccessRefusal>;

/**
 * The one access rule for coach-facing reads (ADR 0006, R-39, checklist
 * 1-3): nothing without an active Coach link; the display name with the
 * link alone; a repertoire only when the player shared it with this coach.
 */
export function canCoachSee(
  coachId: string,
  playerId: string,
  subject: CoachSubject,
  facts: CoachAccessFacts,
): AccessResult {
  if (coachId === playerId || !facts.linked)
    return refuse(ACCESS_REFUSALS.notLinked);
  if (subject.kind === 'profile') return ok();
  return facts.sharedRepertoireIds.has(subject.repertoireId)
    ? ok()
    : refuse(ACCESS_REFUSALS.notShared);
}
