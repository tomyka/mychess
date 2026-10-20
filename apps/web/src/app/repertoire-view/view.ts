import type { ActionDispatch } from 'react';
import type { ScreenAction, ScreenState } from './screen-state';
import type { BoardPlay, ScreenBoard } from './use-screen';

/** A repertoire view's screen state, what changes it, and its board. */
export interface RepertoireView {
  readonly state: ScreenState;
  readonly dispatch: ActionDispatch<[action: ScreenAction]>;
  readonly board: ScreenBoard;
  readonly play: BoardPlay;
}
