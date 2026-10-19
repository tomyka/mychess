'use client';

import { chapterOf, moveKey } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useReducer, useState, type ActionDispatch, type JSX } from 'react';
import { coachPlayerPath } from '../../../../../../lib/routes';
import type { SharedRepertoirePage } from '../../../../../../server/coach-pages';
import { Board } from '../../../../../board/board';
import { BoardRow } from '../../../../../repertuarai/[id]/board-row';
import {
  Announcer,
  useBoardWords,
} from '../../../../../repertuarai/[id]/board-words';
import { ChapterList } from '../../../../../repertuarai/[id]/chapter-list';
import { Comment, MarksText } from '../../../../../repertuarai/[id]/move-panel';
import { MoveList } from '../../../../../repertuarai/[id]/move-list';
import {
  initialState,
  screenReducer,
  type ScreenAction,
  type ScreenState,
} from '../../../../../repertuarai/[id]/screen-state';
import { ScreenStatus } from '../../../../../repertuarai/[id]/screen-status';
import {
  useBoardPlay,
  useScreenBoard,
} from '../../../../../repertuarai/[id]/use-screen';
import { PANEL_LABEL } from '../../../../../repertuarai/[id]/panel-styles';
import { withNote } from '../../../../../repertuarai/[id]/notes-by-move';
import { CoachNoteForm } from './coach-note-form';

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/** No move list marks: the coach has no Personal notes here. */
const NO_NOTES: Readonly<Record<string, string>> = {};

/** The screen as it opens: browsing, even a repertoire without chapters. */
const opened = (data: SharedRepertoirePage): ScreenState => ({
  ...initialState(data.graph, 0),
  mode: 'browse',
});

/** The way back to the player, the name and what the coach may do here. */
function SharedHeader({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('coach.shared');
  return (
    <header className="flex flex-col gap-1 px-gutter py-2 lg:px-0 lg:py-0">
      <Link
        href={coachPlayerPath(data.player.id)}
        className="inline-flex min-h-touch items-center self-start text-accent underline"
      >
        {t('back', { name: data.player.displayName })}
      </Link>
      <h1
        title={data.repertoire.name}
        className="truncate text-lg font-semibold lg:whitespace-normal lg:text-3xl lg:font-bold"
      >
        {data.repertoire.name}
      </h1>
      <p className="text-sm text-fg-muted">{t('readOnly')}</p>
    </header>
  );
}

/** The coach's notes by move key, and a saver that keeps them current. */
function useCoachNotes(initial: Readonly<Record<string, string>>) {
  const [notes, setNotes] = useState(initial);
  return {
    notes,
    onChange:
      (key: string) =>
      (text: string): void => {
        setNotes((now) => withNote(now, key, text));
      },
  };
}

/** The chapter's intro, or the move's comment and the coach's note on it. */
function SharedPosition({
  data,
  state,
  notes,
}: {
  readonly data: SharedRepertoirePage;
  readonly state: ScreenState;
  readonly notes: ReturnType<typeof useCoachNotes>;
}): JSX.Element | null {
  const t = useTranslations('repertoires.panel');
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  if (chapter === undefined)
    return <p className="text-fg-muted">{t('emptyBrowse')}</p>;
  const move = state.path.at(-1);
  if (move === undefined)
    return chapter.intro === null ? null : (
      <section aria-label={t('intro')} className="flex flex-col gap-1">
        <p className={PANEL_LABEL}>{t('intro')}</p>
        <p>{chapter.intro}</p>
      </section>
    );
  const key = moveKey(move.from, move.san);
  return (
    <section aria-label={t('comment')} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Comment move={move} editor={undefined} />
        <MarksText move={move} />
      </div>
      <CoachNoteForm
        key={key}
        target={{
          playerId: data.player.id,
          repertoireId: data.repertoire.id,
          moveKey: key,
        }}
        playerName={data.player.displayName}
        initial={notes.notes[key] ?? ''}
        onChange={notes.onChange(key)}
      />
    </section>
  );
}

/** Chapters, the position and the moves, scrolling under the board row. */
function SharedPanelBody({
  data,
  state,
  dispatch,
}: {
  readonly data: SharedRepertoirePage;
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
}): JSX.Element {
  const notes = useCoachNotes(data.notes);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0">
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        ecoNames={data.ecoNames}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
      />
      <SharedPosition data={data} state={state} notes={notes} />
      {state.chapterId === null ? null : (
        <div className="lg:min-h-40 lg:flex-1 lg:overflow-y-auto">
          <MoveList
            graph={state.graph}
            chapterId={state.chapterId}
            path={state.path}
            notes={NO_NOTES}
            onGoto={(path) => {
              dispatch({ type: 'goto', path });
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A player's repertoire as the coach it is shared with sees it (R-42):
 * the board, chapters, moves, comments (R-102) and the coach's own notes,
 * with nothing that changes the repertoire. Laid out as the owner's
 * repertoire page (docs/design/repertoire-screen.md).
 */
export function SharedRepertoireView({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  const [state, dispatch] = useReducer(screenReducer, data, opened);
  const board = useScreenBoard(state, data.repertoire.side);
  const play = useBoardPlay(state, dispatch, board, null);
  const words = useBoardWords(
    data.repertoire.name,
    state,
    board.view.fen,
    data.ecoNames,
  );
  return (
    <main className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8">
      <SharedHeader data={data} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        <div className="shrink-0 lg:w-[min(calc(100dvh-12rem),42rem)]">
          <Board
            view={board.view}
            label={words.label}
            describe={words.describe}
            onMove={play.onMove}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:max-h-[calc(100dvh-12rem)] lg:w-panel lg:flex-none lg:rounded-card lg:bg-surface lg:p-4 lg:shadow-card">
          <BoardRow
            state={state}
            dispatch={dispatch}
            board={board}
            play={play}
          />
          <div className="shrink-0 px-gutter lg:px-0">
            <ScreenStatus
              message={state.message}
              stale={false}
              onReload={() => undefined}
            />
          </div>
          <SharedPanelBody data={data} state={state} dispatch={dispatch} />
        </div>
      </div>
      <Announcer state={state} />
    </main>
  );
}
