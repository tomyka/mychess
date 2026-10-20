'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useReducer } from 'react';
import { initialState, screenReducer } from './screen-state';
import { useBoardPlay, useScreenBoard } from './use-screen';
import type { RepertoireView } from './view';

/** The repertoire a view that edits opens on. */
export interface OpenedRepertoire {
  readonly graph: RepertoireGraph;
  readonly version: number;
  /** The chapter to open on; null, unknown or absent opens the first. */
  readonly chapterId?: string | null | undefined;
}

/**
 * What builder mode does with a move the chapter does not have, given the
 * screen as it is and the position the move is played from.
 */
export type AddNew = (
  state: RepertoireView['state'],
  dispatch: RepertoireView['dispatch'],
  from: string,
) => (san: string) => void;

/**
 * A view that edits (the owner's builder): browsing goes to the moves the
 * chapter has; in builder mode any other move is `addNew`'s.
 */
export function useBuilderView(
  opened: OpenedRepertoire,
  side: Side,
  addNew: AddNew,
): RepertoireView {
  const [state, dispatch] = useReducer(screenReducer, opened, (o) =>
    initialState(o.graph, o.version, o.chapterId ?? null),
  );
  const board = useScreenBoard(state, side);
  const play = useBoardPlay(
    state,
    dispatch,
    board,
    state.mode === 'build' ? addNew(state, dispatch, board.key) : null,
  );
  return { state, dispatch, board, play };
}
