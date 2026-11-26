import 'server-only';
// A repertoire as a viewer sees it: what the owner's page, the assigned
// page and the coach's shared view all show. Each loader decides access
// its own way first (Q26: the owner through canViewRepertoire, the
// assigned player through their live assignment, the coach through
// canCoachSee), each query filtering again, and reads the viewer's own
// notes; this only shapes what that read found for the page.
import type { RepertoireGraph, Side } from '@mychess/chess';
import type { LoadedRepertoire } from '@mychess/db';
import type { ChapterNames } from '../lib/chapter-label';
import { chapterNamesOf } from './chapter-names';

/** Notes by move key. */
export type NotesByMove = Readonly<Record<string, string>>;

/** What every repertoire page shows, whoever views it. */
export interface RepertoireForViewer {
  readonly repertoire: {
    readonly id: string;
    readonly name: string;
    readonly side: Side;
  };
  /** With its move comments (R-102). */
  readonly graph: RepertoireGraph;
  /** What titles its chapters: opening names and distinctions (R-158). */
  readonly names: ChapterNames;
  /**
   * The viewer's own notes on it, by move key: a player's Personal notes
   * (R-21), a coach's own Coach notes (R-125); never anyone else's.
   */
  readonly notes: NotesByMove;
}

/**
 * A repertoire as a player who has it (its owner, or by assignment) sees
 * it: with the version shown, which keys the page and which an assigned
 * page marks seen (R-133). Not the coach's: how often a player edits is
 * not theirs to watch.
 */
export interface VersionedRepertoireForViewer extends RepertoireForViewer {
  readonly repertoire: RepertoireForViewer['repertoire'] & {
    readonly version: number;
  };
}

/**
 * `found`, a repertoire the viewer may see, with the viewer's `notes` as
 * its page shows it: no owner, no version and no timestamps.
 */
export function repertoireForViewer(
  found: LoadedRepertoire,
  notes: NotesByMove,
): RepertoireForViewer {
  const { id, name, side } = found.repertoire;
  return {
    repertoire: { id, name, side },
    graph: found.graph,
    names: chapterNamesOf(found.graph),
    notes,
  };
}

/** `repertoireForViewer` with the version shown, for a player who has it. */
export function versionedRepertoireForViewer(
  found: LoadedRepertoire,
  notes: NotesByMove,
): VersionedRepertoireForViewer {
  const view = repertoireForViewer(found, notes);
  return {
    ...view,
    repertoire: { ...view.repertoire, version: found.repertoire.version },
  };
}
