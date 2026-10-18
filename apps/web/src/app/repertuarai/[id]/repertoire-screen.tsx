'use client';

import type { Key } from '@lichess-org/chessground/types';
import {
  chapterChildren,
  chapterOf,
  moveKey,
  sideToMove,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReducer, type ActionDispatch, type JSX } from 'react';
import { chapterLabel } from '../../../lib/chapter-label';
import { importIntoRoute } from '../../../lib/routes';
import { Board } from '../../board/board';
import { MoveInput } from '../../board/move-input';
import { PromotionPicker } from '../../board/promotion-picker';
import { pieceAt } from '../../board/squares';
import { SECONDARY_BUTTON } from '../../buttons';
import { moveNumber } from './board-play';
import { ChapterList } from './chapter-list';
import { MoveList } from './move-list';
import { MovePanel } from './move-panel';
import { NavButtons } from './nav-buttons';
import { RepertoireActions, RepertoireHeader } from './repertoire-header';
import {
  currentKey,
  initialState,
  screenReducer,
  type ScreenAction,
  type ScreenState,
} from './screen-state';
import { ScreenStatus } from './screen-status';
import {
  useBrowsePlay,
  useNotes,
  useScreenBoard,
  type BrowsePlay,
  type Notes,
  type ScreenBoard,
} from './use-screen';

export interface RepertoireScreenProps {
  readonly repertoire: {
    readonly id: string;
    readonly name: string;
    readonly side: Side;
    readonly version: number;
  };
  readonly graph: RepertoireGraph;
  /** The viewer's Personal notes by move key (R-21). */
  readonly notes: Readonly<Record<string, string>>;
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
}

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/** The board's accessible name and its cursor announcement. */
function useBoardWords(
  props: RepertoireScreenProps,
  state: ScreenState,
  fen: string,
) {
  const t = useTranslations();
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  const { name } = props.repertoire;
  return {
    label:
      chapter === undefined
        ? t('repertoires.board.labelNoChapter', { name })
        : t('repertoires.board.label', {
            name,
            chapter: chapterLabel(t, props.ecoNames)(chapter),
          }),
    describe: (square: Key): string => {
      const piece = pieceAt(fen, square);
      return t('board.cursor', {
        square,
        piece:
          piece === null
            ? t('board.empty')
            : t(`board.pieces.${piece.color}.${piece.role}`),
      });
    },
  };
}

/** The last step for screen readers: "6. Be2", and "end of line" at a leaf. */
function Announcer({ state }: { readonly state: ScreenState }): JSX.Element {
  const t = useTranslations('repertoires.nav');
  const last = state.path.at(-1);
  let text = '';
  if (last !== undefined && state.chapterId !== null) {
    const root = chapterOf(state.graph, state.chapterId)?.rootKey ?? last.from;
    const move = `${moveNumber(state.path.length - 1, sideToMove(root) === 'w')} ${last.san}`;
    const leaf =
      chapterChildren(state.graph)(state.chapterId)(last.to).length === 0;
    text = leaf ? t('endOfLine', { move }) : move;
  }
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

/** The typed-move field (or the promotion choice) and the step buttons. */
function BoardRow({
  state,
  dispatch,
  board,
  play,
}: {
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly board: ScreenBoard;
  readonly play: BrowsePlay;
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
        disabled={state.saving || state.chapterId === null}
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

/** A repertoire without chapters: play the first move, or add games from PGN. */
function EmptyRepertoire({
  id,
  mode,
}: {
  readonly id: string;
  readonly mode: ScreenState['mode'];
}): JSX.Element {
  const t = useTranslations('repertoires.panel');
  if (mode === 'browse')
    return <p className="text-fg-muted">{t('emptyBrowse')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p>{t('emptyBuild')}</p>
      <Link
        href={importIntoRoute(id)}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {t('addFromPgn')}
      </Link>
    </div>
  );
}

/** The chapter's intro, or the current move's comment and note, or the empty state. */
function PositionSection({
  props,
  state,
  notes,
}: {
  readonly props: RepertoireScreenProps;
  readonly state: ScreenState;
  readonly notes: Notes;
}): JSX.Element | null {
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  if (chapter === undefined)
    return <EmptyRepertoire id={props.repertoire.id} mode={state.mode} />;
  const last = state.path.at(-1);
  const key = last === undefined ? '' : moveKey(last.from, last.san);
  return (
    <MovePanel
      intro={chapter.intro}
      move={last ?? null}
      note={notes.notes[key] ?? ''}
      onSaveNote={notes.save(key)}
    />
  );
}

/** The repertoire's actions at the end of the panel, on a phone only. */
function PhoneActions({
  id,
  name,
}: {
  readonly id: string;
  readonly name: string;
}): JSX.Element {
  const t = useTranslations('repertoires.header');
  return (
    <section
      aria-label={t('section')}
      className="flex flex-col gap-2 lg:hidden"
    >
      <h2 className="text-sm font-semibold text-fg-muted">{t('section')}</h2>
      <RepertoireActions id={id} name={name} />
    </section>
  );
}

/** The scrolling part of the panel: status, chapters, position, moves. */
function PanelBody({
  props,
  state,
  dispatch,
  notes,
}: {
  readonly props: RepertoireScreenProps;
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly notes: Notes;
}): JSX.Element {
  const router = useRouter();
  const { id, name } = props.repertoire;
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0">
      <ScreenStatus
        message={state.message}
        stale={state.stale}
        onReload={() => {
          router.refresh();
        }}
      />
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        ecoNames={props.ecoNames}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
      />
      <div className="lg:order-1">
        <PositionSection props={props} state={state} notes={notes} />
      </div>
      {chapter === undefined ? null : (
        <MoveList
          graph={state.graph}
          chapterId={state.chapterId}
          path={state.path}
          notes={notes.notes}
          onGoto={(path) => {
            dispatch({ type: 'goto', path });
          }}
        />
      )}
      <PhoneActions id={id} name={name} />
    </div>
  );
}

/**
 * The repertoire page, browsing (docs/design/repertoire-screen.md, section
 * 2): on a phone the top bar, board and board row stay put and the panel
 * scrolls below; on a desktop the board and the panel sit side by side.
 */
export function RepertoireScreen(props: RepertoireScreenProps): JSX.Element {
  const { repertoire } = props;
  const [state, dispatch] = useReducer(screenReducer, props, (p) =>
    initialState(p.graph, p.repertoire.version),
  );
  const board = useScreenBoard(state, repertoire.side);
  const play = useBrowsePlay(state, dispatch, board);
  const notes = useNotes(repertoire.id, props.notes);
  const words = useBoardWords(props, state, board.view.fen);
  return (
    <main className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8">
      <RepertoireHeader id={repertoire.id} name={repertoire.name} />
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
          <PanelBody
            props={props}
            state={state}
            dispatch={dispatch}
            notes={notes}
          />
        </div>
      </div>
      <Announcer state={state} />
    </main>
  );
}
