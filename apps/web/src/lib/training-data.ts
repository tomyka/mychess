// What the training page sends the browser (S6 decision 1): plain data the
// server's loader (server/training.ts) fills from the session account's
// snapshot, and the browser builds its queue and learn plan from (chess's
// training day, through lib/training-day.ts). Types only, so both sides
// share them without importing each other.
import type {
  RepertoireGraph,
  ReviewState,
  Side,
  TrainingMode,
} from '@mychess/chess';
import type { OwnCoachNote, TrainingSettings } from '@mychess/domain';

/** What every repertoire the player trains has, as the browser needs it. */
interface EntryBase {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  /** False while its assignment is paused: no new Moves from it. */
  readonly active: boolean;
  readonly graph: RepertoireGraph;
}

/**
 * One repertoire the player trains: their own, or assigned by a coach
 * (which page it lives on), with the assigning coach's display name.
 */
type TrainingDataEntry =
  | (EntryBase & { readonly kind: 'own' })
  | (EntryBase & { readonly kind: 'assigned'; readonly coachName: string });

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
  /** Tracked keys among them, a Review exists (R-181). */
  readonly tracked: readonly string[];
  /** Moves learned in the player's day so far (R-147). */
  readonly learnedToday: number;
  readonly settings: TrainingSettings;
  /**
   * The coach notes on the own entries: a sharing coach's (R-107) or one a
   * fork kept (R-43, R-49), each named; no coach account id reaches the
   * browser. An assigned entry's notes are its comments (R-102).
   */
  readonly coachNotes: readonly OwnCoachNote[];
  /** The instant the snapshot was read at. */
  readonly now: Date;
}
