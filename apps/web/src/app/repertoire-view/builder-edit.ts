// The builder's one way to save (docs/design/repertoire-screen.md, Phone,
// builder): every edit goes through the owner's save with the version the
// screen holds, one at a time; the chess package decides each one on the
// server. Internal to the builder (use-repertoire-builder.tsx).
import type { EditOp, RepertoireGraph, RepertoireMove } from '@mychess/chess';
import type { ActionDispatch } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import type { FieldOutcome } from './field-save';
import { SAVING, type ScreenAction, type ScreenMessage } from './screen-state';

/** One edit as the owner's save sends it: the op and the version it is on. */
interface BuilderEdit {
  readonly version: number;
  readonly op: EditOp;
}

/**
 * What the owner's save came to: the saved graph, its version and what
 * titles its chapters (R-158), or a catalogue key and the limit it names
 * when it is one (R-162).
 */
export type BuilderSaved =
  | {
      readonly ok: true;
      readonly graph: RepertoireGraph;
      readonly version: number;
      readonly names: ChapterNames;
    }
  | {
      readonly ok: false;
      readonly refusal: string;
      readonly limit?: number;
    };

/** The owner's save (the page's edit action, with its repertoire bound). */
export type BuilderSave = (edit: BuilderEdit) => Promise<BuilderSaved>;

/** Where the screen goes once an edit is saved. */
interface Placement {
  readonly chapterId?: string | null;
  readonly path?: readonly RepertoireMove[];
  readonly message?: ScreenMessage;
}

/** One edit: `place` says where to go after it; a `field` shows its own refusal. */
export type Edit = (
  op: EditOp,
  options?: {
    readonly place?: (graph: RepertoireGraph) => Placement;
    readonly field?: boolean;
  },
) => Promise<FieldOutcome>;

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/** After this long a save says "Saving" (docs/design, Saving). */
const SAVING_AFTER_MS = 1000;
const FAILED = 'repertoires.failed';
const STALE = 'repertoire.stale';

/**
 * A refusal landed: a field shows its own and the screen settles, unless
 * the repertoire changed elsewhere, which the whole screen shows; a board
 * edit's shows in the status line and puts the pieces back.
 */
function refuser(dispatch: Dispatch) {
  return (refusal: string, field: boolean, limit?: number): FieldOutcome => {
    if (field && refusal !== STALE) dispatch({ type: 'settled' });
    else {
      dispatch(
        limit === undefined
          ? { type: 'refused', reason: refusal }
          : { type: 'refused', reason: refusal, values: { limit } },
      );
      dispatch({ type: 'reset' });
    }
    return { ok: false, refusal };
  };
}

/**
 * Sends one edit through `save` with the screen's `version` and lands its
 * outcome: the new graph and what titles its chapters, or the refusal.
 */
export function editor(
  save: BuilderSave,
  version: number,
  dispatch: Dispatch,
  onNames: (names: ChapterNames) => void,
): Edit {
  const refuse = refuser(dispatch);
  return async (op, { place, field = false } = {}) => {
    dispatch({ type: 'saving' });
    const timer = setTimeout(() => {
      dispatch({ type: 'say', message: { key: SAVING, tone: 'info' } });
    }, SAVING_AFTER_MS);
    try {
      const outcome = await save({ version, op });
      if (!outcome.ok) return refuse(outcome.refusal, field, outcome.limit);
      onNames(outcome.names);
      const { graph } = outcome;
      dispatch({
        type: 'saved',
        graph,
        version: outcome.version,
        ...place?.(graph),
      });
      return { ok: true };
    } catch {
      return refuse(FAILED, field);
    } finally {
      clearTimeout(timer);
    }
  };
}
