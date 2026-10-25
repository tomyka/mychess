// One repertoire view (#283): the layout, panel, position body, notes and
// board state that the owner's page, the coach's shared view and the
// assigned view are built from. Everything outside this folder imports from
// here, never from the parts.

// The view: shell, panel content, the browse-only and builder views, the
// loading state.
export { RepertoireShell } from './repertoire-shell';
export type { PanelContent } from './repertoire-panel';
export type { RepertoireView } from './view';
export { useBrowseView } from './use-browse-view';
export { useBuilderView } from './use-builder-view';
export {
  EMPTY_BOARD,
  RepertoireLoadingShell,
  SKELETON_LINE,
} from './loading-shell';
export { PANEL_LABEL } from './panel-styles';

// A read-only view's top bar: its frame and the way back.
export { BackLink, HeaderFrame } from './view-header';

// Notes on moves: the viewer's Personal note, the coaches' notes, and notes
// kept by move key.
export { PersonalNote, type NoteOutcome } from './personal-note';
export { useNotes, type Notes } from './use-notes';
export { useNotesByMove } from './notes-by-move';
export { CoachNotes, type MoveCoachNote } from './coach-notes';

// Move labels: the number written before a move, `6.` or `6...`, as the
// move list writes it (the "what changed" summary uses it too).
export { moveNumber } from './board-play';

// A move played on the board: the legal moves joining its two squares (one,
// or four promotions). The training drills take moves the same way.
export { movesBetween } from './board-play';

// The builder block: only the owner's builder hooks
// (repertuarai/[id]/use-builder.ts) use these, to turn the screen state into
// edits (where a new move lands, what a mark change says, the remove bar)
// and to fill the panel's builder fields.
export { SAVING, type ScreenMessage } from './screen-state';
export { canMark } from './use-screen';
export { markChange, placeAdded } from './board-play';
export type { ChapterBuilder } from './chapter-list';
export type { CommentEditor } from './comment';
export type { FieldOutcome } from './field-save';
