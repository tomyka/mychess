/**
 * Who has a coach's repertoire, counted, by the two rules the screens use
 * (#395). Both count distinct players a row reaches (reach.ts in
 * `@mychess/db`: a linked player's own row, or a row of a group they are
 * in, R-16):
 *
 * - its assignees (assigneeCount): every reached player, those who forked
 *   it included, as My repertoires' "Assigned to N" (R-225, R-230), so the
 *   count agrees with the teaching fact;
 * - its live players (livePlayerCount): only those who have it live
 *   (canUseAssignment: not forked, R-128), as the delete dialog says how
 *   many players have it, those who get a fork offer (R-131).
 */
import { canUseAssignment, type AssignmentFacts } from './assignment';

/** How many distinct players `reached` names, forked or not (R-225, R-230). */
export const assigneeCount = (
  reached: readonly { readonly playerId: string }[],
): number => new Set(reached.map((one) => one.playerId)).size;

/** How many distinct players have it live: reached and not forked (R-131). */
export const livePlayerCount = (facts: readonly AssignmentFacts[]): number =>
  assigneeCount(facts.filter((one) => canUseAssignment(one).ok));
