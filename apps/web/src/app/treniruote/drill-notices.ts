// What a drill shows beside a move once it is answered or taught (R-174,
// #330 decision 4): its Coach notes and the other repertoires' answers in
// its position (R-54). The drills' hooks decide when there is a move to
// give; both hold a right answer on these until Next.
import {
  twoAnswers,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import type { DrillCoachNote } from '@mychess/domain';
import type { TrainingData } from '../../lib/training-data';
import { coachNotesFor } from './coach-note';

/** A repertoire the player trains, by name. */
export interface NamedRepertoire {
  readonly id: string;
  readonly name: string;
  readonly graph: RepertoireGraph;
}

/** Another repertoire that plays another move where the drill is (R-54). */
export interface OtherAnswer {
  readonly repertoireId: string;
  readonly name: string;
  readonly san: string;
}

/** Every repertoire the player trains, by name: the session's and the others. */
export const namedOf = (data: TrainingData): NamedRepertoire[] =>
  [...data.entries, ...data.others].map(({ id, name, graph }) => ({
    id,
    name,
    graph,
  }));

/**
 * R-54: each other repertoire that plays another move than `move` of
 * `repertoireId`, in its position, with its name; none without a move.
 */
function otherAnswers(
  move: RepertoireMove | undefined,
  repertoireId: string | undefined,
  repertoires: readonly NamedRepertoire[],
): readonly OtherAnswer[] {
  if (move === undefined || repertoireId === undefined) return [];
  const nameOf = (id: string): string =>
    repertoires.find((r) => r.id === id)?.name ?? '';
  return twoAnswers(move.from, move.san, repertoireId, repertoires).map(
    (a) => ({
      repertoireId: a.repertoireId,
      name: nameOf(a.repertoireId),
      san: a.san,
    }),
  );
}

/** What the panel shows with a move: its Coach notes and the other answers. */
export interface DrillNotices {
  readonly notes: readonly DrillCoachNote[];
  readonly answers: readonly OtherAnswer[];
}

/** The notices on `move` of repertoire `repertoireId`; none without a move. */
export const drillNotices = (
  data: TrainingData,
  named: readonly NamedRepertoire[],
  repertoireId: string | undefined,
  move: RepertoireMove | undefined,
): DrillNotices => ({
  notes: coachNotesFor(data, repertoireId, move),
  answers: otherAnswers(move, repertoireId, named),
});

/** Is there anything to read, so a right answer waits for Next? */
export const hasNotices = (n: DrillNotices): boolean =>
  n.notes.length > 0 || n.answers.length > 0;
