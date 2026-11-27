// One repertoire view (#283): the layout, panel, position body, notes and
// board state that the owner's page, the coach's shared view and the
// assigned view are built from. Everything outside this folder imports from
// here, never from the parts.

// The view: shell, panel content, status messages, the browse-only view,
// the loading state.
export { RepertoireShell } from './repertoire-shell';
export type { PanelContent } from './repertoire-panel';
export type { RepertoireView } from './view';
export type { ScreenMessage } from './screen-state';
export { useBrowseView } from './use-browse-view';

// The owner's builder: given the repertoire and the owner's save, the
// screen state, the board's adding and drawing, the chapter and comment
// fields and the builder row (#387).
export {
  useRepertoireBuilder,
  type RepertoireBuilder,
} from './use-repertoire-builder';
export {
  EMPTY_BOARD,
  RepertoireLoadingShell,
  SKELETON_LINE,
} from './loading-shell';
export { PANEL_LABEL } from './panel-styles';

// The repertoire's header: the top bar (back, name, Edit, More) and the
// summary line and status strip under the name (spec, Header).
export { RepertoireTopBar } from './top-bar';
export { SummaryLine } from './summary-line';

// Notes on moves: the viewer's Personal note, the coaches' notes, and notes
// kept by move key.
export { PersonalNote, type NoteOutcome } from './personal-note';
export { useNotes, type Notes } from './use-notes';
export { useNotesByMove } from './notes-by-move';
export { CoachNotes, type MoveCoachNote } from './coach-notes';
export { PEN_GLYPH } from './move-list';
export { moveLabel } from './move-label';

// A move played on the board: the legal moves joining its two squares (one,
// or four promotions). The training drills take moves the same way.
export { movesBetween } from './board-play';
