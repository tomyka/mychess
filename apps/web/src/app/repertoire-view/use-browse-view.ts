'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useReducer } from 'react';
import type { MessageKey } from '../../i18n/message-key';
import { initialState, screenReducer, type ScreenState } from './screen-state';
import { NOT_IN_REPERTOIRE, useBoardPlay, useScreenBoard } from './use-screen';
import type { RepertoireView } from './view';

/** The screen as it opens: browsing, even a repertoire without chapters. */
const opened = (graph: RepertoireGraph): ScreenState => ({
  ...initialState(graph, 0),
  mode: 'browse',
});

/**
 * A view that only browses (no builder): the board goes to the moves the
 * chapter has and refuses any other, saying `refusal` (a catalogue key).
 */
export function useBrowseView(
  graph: RepertoireGraph,
  side: Side,
  refusal: MessageKey = NOT_IN_REPERTOIRE,
): RepertoireView {
  const [state, dispatch] = useReducer(screenReducer, graph, opened);
  const board = useScreenBoard(state, side);
  const play = useBoardPlay(state, dispatch, board, { refusal });
  return { state, dispatch, board, play };
}
