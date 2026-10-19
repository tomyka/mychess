'use client';

import { chapterChildren } from '@mychess/chess';
import type { ActionDispatch, JSX } from 'react';
import { MoveInput } from '../../board/move-input';
import { PromotionPicker } from '../../board/promotion-picker';
import { NavButtons } from './nav-buttons';
import {
  currentKey,
  type ScreenAction,
  type ScreenState,
} from './screen-state';
import type { BoardPlay, ScreenBoard } from './use-screen';

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/** The typed-move field (or the promotion choice) and the step buttons. */
export function BoardRow({
  state,
  dispatch,
  board,
  play,
}: {
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly board: ScreenBoard;
  readonly play: BoardPlay;
}): JSX.Element {
  if (play.promotion !== null)
    return (
      <div className="shrink-0 px-gutter py-2 lg:px-0">
        <PromotionPicker
          color={board.view.turnColor}
          onPick={play.pick}
          onCancel={play.cancel}
        />
      </div>
    );
  const key = currentKey(state);
  const canForward =
    key !== null &&
    state.chapterId !== null &&
    chapterChildren(state.graph)(state.chapterId)(key).length > 0;
  return (
    <div className="flex shrink-0 items-center gap-2 px-gutter py-2 lg:px-0">
      <MoveInput
        onTyped={play.onTyped}
        disabled={
          state.saving || (state.chapterId === null && state.mode !== 'build')
        }
      />
      <NavButtons
        atRoot={state.path.length === 0}
        atEnd={!canForward}
        onStart={() => {
          dispatch({ type: 'goto', path: [] });
        }}
        onBack={() => {
          dispatch({ type: 'back' });
        }}
        onForward={() => {
          dispatch({ type: 'forward' });
        }}
      />
    </div>
  );
}
