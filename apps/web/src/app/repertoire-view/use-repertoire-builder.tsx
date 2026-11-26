'use client';

// The owner's builder (docs/design/repertoire-screen.md, Phone, builder) as
// one module: the screen state, the board's moves (a move the chapter lacks
// is added in builder mode), drawing, the chapter and comment fields and the
// builder row. The owner gives it the repertoire and its save; whether the
// builder's own parts show (the row, the fields, adding a move) is decided
// here, once.
import type { RepertoireGraph, Side } from '@mychess/chess';
import {
  useReducer,
  useState,
  type ActionDispatch,
  type JSX,
  type ReactNode,
} from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { BuilderBar } from './builder-bar';
import { useDrawing, type Drawing } from './builder-drawing';
import { editor, type BuilderSave, type Edit } from './builder-edit';
import {
  addMove,
  chapterBuilder,
  commentEditor,
  removalTarget,
  removeMove,
} from './builder-edits';
import type { PanelContent } from './repertoire-panel';
import {
  editsBlocked,
  initialState,
  screenReducer,
  type ScreenAction,
  type ScreenState,
} from './screen-state';
import { NOT_IN_REPERTOIRE, useBoardPlay, useScreenBoard } from './use-screen';
import type { RepertoireView } from './view';

/** The repertoire the builder opens on, and the owner's save. */
export interface BuilderOptions {
  readonly graph: RepertoireGraph;
  readonly version: number;
  readonly side: Side;
  /** The chapter to open on; null, unknown or absent opens the first. */
  readonly chapterId?: string | null | undefined;
  /** What titles the chapters as the page loaded them (R-158). */
  readonly names: ChapterNames;
  /** Sends one edit; the builder sends one at a time, with its version. */
  readonly save: BuilderSave;
}

/** The builder's whole contribution to the repertoire shell. */
export interface RepertoireBuilder {
  /** The screen state and the board; in builder mode a new move is saved. */
  readonly view: RepertoireView;
  /** What titles the chapters, as of the last save. */
  readonly names: ChapterNames;
  readonly building: boolean;
  /**
   * The Edit switch: builder mode on or off. The supported way to change
   * mode; do not dispatch `mode` on `view` directly.
   */
  readonly setBuilding: (on: boolean) => void;
  /** Drawing marks on the board (builder mode, on a move). */
  readonly drawing: Drawing;
  /** The builder row under the board row; null while browsing. */
  readonly toolbar: ReactNode;
  /** The panel's builder fields; absent while browsing. */
  readonly panel: Pick<PanelContent, 'chapterBuilder' | 'comment'>;
}

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/**
 * The builder row, once there is a chapter: remove the current move after a
 * confirmation, draw.
 */
function BuilderRow({
  state,
  dispatch,
  edit,
}: {
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly edit: Edit;
}): JSX.Element | null {
  if (state.chapterId === null) return null;
  const { move, count } = removalTarget(state);
  return (
    <div className="shrink-0 px-gutter pb-2 lg:px-0">
      <BuilderBar
        move={move}
        count={count}
        disabled={editsBlocked(state)}
        drawMode={state.drawMode}
        drawColor={state.drawColor}
        onRemove={removeMove(state, edit)}
        onDraw={(on) => {
          dispatch({ type: 'draw', on });
        }}
        onColor={(color) => {
          dispatch({ type: 'drawColor', color });
        }}
      />
    </div>
  );
}

/** What builder mode adds to the panel and under the board row. */
function builderParts(
  state: ScreenState,
  dispatch: Dispatch,
  edit: Edit,
): Pick<RepertoireBuilder, 'toolbar' | 'panel'> {
  if (state.mode !== 'build') return { toolbar: null, panel: {} };
  return {
    toolbar: <BuilderRow state={state} dispatch={dispatch} edit={edit} />,
    panel: {
      chapterBuilder: chapterBuilder(state, edit),
      comment: { editor: commentEditor(state, edit) },
    },
  };
}

/** The owner's builder, given the repertoire it opens on and its save. */
export function useRepertoireBuilder(
  options: BuilderOptions,
): RepertoireBuilder {
  const [state, dispatch] = useReducer(screenReducer, options, (o) =>
    initialState(o.graph, o.version, o.chapterId ?? null),
  );
  const [names, setNames] = useState(options.names);
  const building = state.mode === 'build';
  const edit = editor(options.save, state.version, dispatch, setNames);
  const board = useScreenBoard(state, options.side);
  const play = useBoardPlay(
    state,
    dispatch,
    board,
    building
      ? { addNew: addMove(state, edit, board.key) }
      : { refusal: NOT_IN_REPERTOIRE },
  );
  const drawing = useDrawing(state, dispatch, edit);
  return {
    view: { state, dispatch, board, play },
    names,
    building,
    setBuilding: (on) => {
      dispatch({ type: 'mode', mode: on ? 'build' : 'browse' });
    },
    drawing,
    ...builderParts(state, dispatch, edit),
  };
}
