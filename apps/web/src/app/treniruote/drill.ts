// What the training screen hands a drill (ReviewDrill, LearnDrill). The
// screen owns the page: the frame, the way back, the sync banner and the
// empty states; a drill owns its session, from the first item to its done
// summary, and draws itself through `frame`.
import type { JSX, ReactNode } from 'react';
import type { TrainingData } from '../../server/training';
import type { ResultSync } from './use-result-sync';

/** The parts of the screen a drill fills (docs/design/training-screen.md). */
export interface FrameParts {
  /** The top bar's title; absent, the repertoire's name or the mode's title. */
  readonly title?: string;
  /** The session's done / total: the counter and the progress bar. */
  readonly progress?: { readonly done: number; readonly total: number };
  /** The drill's board; absent, the start position, dimmed and inert. */
  readonly board?: ReactNode;
  /** The session is over: the board is dimmed and inert, and a phone hides it. */
  readonly finished?: boolean;
  /** The panel under the sync banner: prompt, line so far, summary. */
  readonly panel: ReactNode;
  /** The bottom bar: End session, or the done summary's buttons. */
  readonly actions?: ReactNode;
}

/** Where a session leads out to. */
export interface TrainingLinks {
  /** Where the player came from: the repertoire's page, or home. */
  readonly back: string;
  /** The learn pass over the same scope. */
  readonly learn: string;
}

export interface DrillProps {
  readonly data: TrainingData;
  /** Record each result here; it queues and syncs them (R-60). */
  readonly sync: ResultSync;
  readonly links: TrainingLinks;
  /** Draws the screen around the drill's parts, with the banner and the way back. */
  readonly frame: (parts: FrameParts) => JSX.Element;
}
