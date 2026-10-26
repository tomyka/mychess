// What the training page sends the browser (S6 decision 1): plain data the
// server's loader (server/training.ts) fills from the session account's
// snapshot, and the browser builds its queue and learn plan from
// (lib/training-counts.ts). Types only, so both sides share them without
// importing each other.
import type { RepertoireGraph, ReviewState, Side } from '@mychess/chess';
import type { RepertoireKind, TrainingSettings } from '@mychess/domain';
import type { TrainingMode } from './routes';

/** One repertoire the player trains, as the browser needs it. */
interface TrainingDataEntry {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  /** The player's own, or assigned by a coach: which page it lives on. */
  readonly kind: RepertoireKind;
  /** False while its assignment is paused: no new Moves from it. */
  readonly active: boolean;
  readonly graph: RepertoireGraph;
}

/** Another repertoire the player trains, for the "two answers" notice. */
interface TrainingDataOther {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  readonly graph: RepertoireGraph;
}

/** What the training page sends the browser: plain data only. */
export interface TrainingData {
  readonly mode: TrainingMode;
  /** In the learn order (R-145). */
  readonly entries: readonly TrainingDataEntry[];
  /**
   * Every other repertoire the player trains, paused ones included, when
   * the session is scoped to one: where the browser finds the other held
   * repertoires that play a different move (S6 decision 6). Empty for
   * every repertoire.
   */
  readonly others: readonly TrainingDataOther[];
  /** The held Reviews (dormant ones left out). */
  readonly reviews: readonly ReviewState[];
  /** Keys learned or skipped among them. */
  readonly learned: readonly string[];
  /** Moves learned in the player's day so far (R-147). */
  readonly learnedToday: number;
  readonly settings: TrainingSettings;
  /** The earliest due of the active entries' Reviews, for the empty state. */
  readonly nextDue: Date | null;
  /** The instant the snapshot was read at. */
  readonly now: Date;
}
