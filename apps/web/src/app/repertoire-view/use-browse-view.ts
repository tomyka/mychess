'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useReducer } from 'react';
import { initialState, screenReducer, type ScreenState } from './screen-state';
import { useBoardPlay, useScreenBoard } from './use-screen';
import type { RepertoireView } from './view';

/** The screen as it opens: browsing, even a repertoire without chapters. */
const opened = (graph: RepertoireGraph): ScreenState => ({
  ...initialState(graph, 0),
  mode: 'browse',
});

/**
 * A view that only browses (no builder): the board goes to the moves the
 * chapter has and refuses any other.
 */
export function useBrowseView(
  graph: RepertoireGraph,
  side: Side,
): RepertoireView {
  const [state, dispatch] = useReducer(screenReducer, graph, opened);
  const board = useScreenBoard(state, side);
  const play = useBoardPlay(state, dispatch, board, null);
  return { state, dispatch, board, play };
}
