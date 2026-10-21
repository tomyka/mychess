/**
 * Settling a change to assignments (#289): what happens to the players a
 * change touches, decided from what they had before it and after it. The
 * database reads the facts, asks for the plan and writes it.
 */
import { canUseAssignment, type AssignmentFacts } from './assignment';

/** One player's assignment of one repertoire. */
export interface PlayerRepertoire {
  readonly playerId: string;
  readonly repertoireId: string;
}

export interface SettlementFacts {
  /** The acting coach: only their repertoires are offered or closed. */
  readonly coachId: string;
  /** In the caller's order; repeats count once. */
  readonly playerIds: readonly string[];
  readonly before: readonly AssignmentFacts[];
  readonly after: readonly AssignmentFacts[];
  /** The repertoire an assign gives: forked players have it live again (R-128). */
  readonly given?: string | undefined;
}

export interface Settlement {
  /** Forked pairs of the given repertoire, cleared (R-128). */
  readonly unfork: readonly PlayerRepertoire[];
  /** Lost pairs: a 30-day fork offer each (R-44, R-45, R-130, R-131). */
  readonly offer: readonly PlayerRepertoire[];
  /** Regained pairs: the open offer closes (S5 lead decision 4). */
  readonly close: readonly PlayerRepertoire[];
}

/** Each player's repertoire ids. */
type LiveSet = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * A pair is live when it is the acting coach's and canUseAssignment allows
 * it. A pair of the given repertoire counts as unforked: the assign makes it
 * live again (R-128).
 */
const isLive = (
  facts: AssignmentFacts,
  coachId: string,
  given: string | undefined,
): boolean =>
  facts.coachId === coachId &&
  canUseAssignment({
    assigned: facts.reaches.length > 0,
    forked: facts.repertoireId !== given && facts.forkedAt !== null,
  }).ok;

function liveSet(
  facts: readonly AssignmentFacts[],
  coachId: string,
  given: string | undefined,
): LiveSet {
  const live = new Map<string, Set<string>>();
  for (const one of facts) {
    if (!isLive(one, coachId, given)) continue;
    const ids = live.get(one.playerId) ?? new Set<string>();
    ids.add(one.repertoireId);
    live.set(one.playerId, ids);
  }
  return live;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The pairs in `a` and not in `b`, by player in `players` order, then by
 * repertoire id.
 */
const difference = (
  a: LiveSet,
  b: LiveSet,
  players: readonly string[],
): PlayerRepertoire[] =>
  players.flatMap((playerId) => {
    const kept = b.get(playerId) ?? NONE;
    return [...(a.get(playerId) ?? NONE)]
      .filter((repertoireId) => !kept.has(repertoireId))
      .sort()
      .map((repertoireId) => ({ playerId, repertoireId }));
  });

/** The forked pairs of the given repertoire after the change, by player. */
function unforked(
  after: readonly AssignmentFacts[],
  players: readonly string[],
  given: string | undefined,
): PlayerRepertoire[] {
  if (given === undefined) return [];
  return players.flatMap((playerId) =>
    after.some(
      (facts) =>
        facts.playerId === playerId &&
        facts.repertoireId === given &&
        facts.forkedAt !== null,
    )
      ? [{ playerId, repertoireId: given }]
      : [],
  );
}

/**
 * The settlement plan of a change (R-16, R-128, R-130, R-131): the acting
 * coach's pairs a named player had live before and not after get an offer,
 * those live after and not before close theirs, and an assign unforks the
 * given repertoire.
 */
export function settleAssignmentChange({
  coachId,
  playerIds,
  before,
  after,
  given,
}: SettlementFacts): Settlement {
  const players = [...new Set(playerIds)];
  const liveBefore = liveSet(before, coachId, undefined);
  const liveAfter = liveSet(after, coachId, given);
  return {
    unfork: unforked(after, players, given),
    offer: difference(liveBefore, liveAfter, players),
    close: difference(liveAfter, liveBefore, players),
  };
}
