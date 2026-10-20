// One repertoire view (#283): the layout, panel, position body, notes and
// board state that the owner's page, the coach's shared view and the
// assigned view are built from. Everything outside this folder imports from
// here, never from the parts.

// The view: shell, panel content, a browse-only view, the loading state.
export { RepertoireShell } from './repertoire-shell';
export type { PanelContent } from './repertoire-panel';
export { PositionBody } from './position-body';
export { useBrowseView } from './use-browse-view';
export { RepertoireLoadingShell, SKELETON_LINE } from './loading-shell';
export { PANEL_LABEL } from './panel-styles';

// Notes on moves: the viewer's Personal note, the coaches' notes.
export { PersonalNote, type NoteOutcome } from './personal-note';
export { useNotes, type Notes } from './use-notes';
export { CoachNotes, type MoveCoachNote } from './coach-notes';
export { withNote } from './notes-by-move';

// What a view that edits (the owner's builder) drives the screen with.
export {
  initialState,
  SAVING,
  screenReducer,
  type ScreenAction,
  type ScreenMessage,
  type ScreenState,
} from './screen-state';
export { canMark, useBoardPlay, useScreenBoard } from './use-screen';
export { markChange, moveNumber, placeAdded, removalCount } from './board-play';
export type { ChapterBuilder } from './chapter-list';
export type { CommentEditor } from './comment';
export type { FieldOutcome } from './field-save';
