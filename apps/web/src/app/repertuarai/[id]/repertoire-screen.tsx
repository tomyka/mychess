'use client';

import {
  chapterOf,
  moveKey,
  sideToMove,
  START_KEY,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useReducer, useState, type ActionDispatch, type JSX } from 'react';
import { importIntoRoute } from '../../../lib/routes';
import type {
  OwnerCoachNote,
  RepertoireSharing,
} from '../../../server/repertoires';
import { Board } from '../../board/board';
import { SECONDARY_BUTTON } from '../../buttons';
import { moveNumber, removalCount } from './board-play';
import { Announcer, useBoardWords } from './board-words';
import { BoardRow } from './board-row';
import { BuilderBar } from './builder-bar';
import { ChapterList } from './chapter-list';
import { ModeSwitch } from './mode-switch';
import { PANEL_LABEL } from './panel-styles';
import { MoveList } from './move-list';
import { MovePanel } from './move-panel';
import { RepertoireActions, RepertoireHeader } from './repertoire-header';
import {
  initialState,
  screenReducer,
  type ScreenAction,
  type ScreenState,
} from './screen-state';
import { ScreenStatus } from './screen-status';
import { ShareWithCoach } from './share-with-coach';
import {
  chapterBuilder,
  commentEditor,
  useAddMove,
  useDrawing,
  useEdit,
  useRemoveMove,
  type Edit,
} from './use-builder';
import { useNotes, type Notes } from './use-notes';
import { useBoardPlay, useScreenBoard } from './use-screen';

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
  /** The chapter to open on; null or unknown opens the first. */
  readonly chapterId?: string | null;
  /** The owner's linked coaches and the shares (R-42). */
  readonly sharing: RepertoireSharing;
  /** Every coach's notes on it, read-only (R-107). */
  readonly coachNotes: readonly OwnerCoachNote[];
}

type Dispatch = ActionDispatch<[action: ScreenAction]>;

/** A repertoire without chapters: play the first move, or add games from PGN. */
function EmptyRepertoire({
  id,
  mode,
  onBuild,
}: {
  readonly id: string;
  readonly mode: ScreenState['mode'];
  readonly onBuild: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  if (mode === 'browse')
    return (
      <div className="flex flex-col gap-3">
        <p className="text-fg-muted">{t('panel.emptyBrowse')}</p>
        <button
          type="button"
          onClick={onBuild}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          {t('mode.toBuild')}
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <p>{t('panel.emptyBuild')}</p>
      <Link
        href={importIntoRoute(id)}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {t('header.importInto')}
      </Link>
    </div>
  );
}

/** The chapter's intro, or the current move's comment and note, or the empty state. */
function PositionSection({
  screen,
  notes,
}: {
  readonly screen: Screen;
  readonly notes: Notes;
}): JSX.Element | null {
  const { props, state, dispatch, edit } = screen;
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  if (chapter === undefined)
    return (
      <EmptyRepertoire
        id={props.repertoire.id}
        mode={state.mode}
        onBuild={() => {
          dispatch({ type: 'mode', mode: 'build' });
        }}
      />
    );
  const last = state.path.at(-1);
  const key = last === undefined ? '' : moveKey(last.from, last.san);
  return (
    <MovePanel
      intro={chapter.intro}
      move={last ?? null}
      note={notes.notes[key] ?? ''}
      onSaveNote={notes.save(key)}
      commentEditor={commentEditor(state, edit)}
      coachNotes={props.coachNotes.filter((n) => n.moveKey === key)}
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
      <h2 className={PANEL_LABEL}>{t('section')}</h2>
      <RepertoireActions id={id} name={name} />
    </section>
  );
}

/** The screen's state and what changes it, as the panel's parts need them. */
interface Screen {
  readonly props: RepertoireScreenProps;
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly edit: Edit;
  /** The opening names the chapters are named after, as of the last save. */
  readonly ecoNames: Readonly<Record<string, string>>;
}

/**
 * The page's status line, under the board row and the builder row and
 * outside the scrolling panel, so a refusal is seen however far the panel
 * has scrolled.
 */
function PanelStatus({ state }: { readonly state: ScreenState }): JSX.Element {
  const router = useRouter();
  return (
    <div className="shrink-0 px-gutter lg:px-0">
      <ScreenStatus
        message={state.message}
        stale={state.stale}
        onReload={() => {
          router.refresh();
        }}
      />
    </div>
  );
}

/**
 * The scrolling part of the panel: chapters, then the position (comment
 * and note), then the moves. The DOM order is the visual order at every
 * width, so Tab follows what the eye sees (WCAG 2.4.3).
 */
function PanelBody({
  screen,
  notes,
}: {
  readonly screen: Screen;
  readonly notes: Notes;
}): JSX.Element {
  const { props, state, dispatch, edit } = screen;
  const { id, name } = props.repertoire;
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0">
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        ecoNames={screen.ecoNames}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
        builder={chapterBuilder(state, edit)}
      />
      <PositionSection screen={screen} notes={notes} />
      {chapter === undefined ? null : (
        // On a desktop the moves scroll on their own, so stepping keeps the
        // comment above them in view; on a phone the whole panel scrolls.
        <div className="lg:min-h-40 lg:flex-1 lg:overflow-y-auto">
          <MoveList
            graph={state.graph}
            chapterId={state.chapterId}
            path={state.path}
            notes={notes.notes}
            building={state.mode === 'build'}
            onGoto={(path) => {
              dispatch({ type: 'goto', path });
            }}
          />
        </div>
      )}
      <PhoneActions id={id} name={name} />
      <ShareWithCoach repertoireId={id} sharing={props.sharing} />
    </div>
  );
}

/**
 * The builder row under the board row, once there is a chapter: remove the
 * current move, draw (docs/design/repertoire-screen.md, Phone, builder).
 */
function ScreenBuilderBar({
  screen,
}: {
  readonly screen: Screen;
}): JSX.Element | null {
  const { state, dispatch, edit } = screen;
  const onRemove = useRemoveMove(state, edit);
  if (state.mode !== 'build' || state.chapterId === null) return null;
  const last = state.path.at(-1);
  const root = chapterOf(state.graph, state.chapterId)?.rootKey ?? START_KEY;
  const label =
    last === undefined
      ? null
      : `${moveNumber(state.path.length - 1, sideToMove(root) === 'w')} ${last.san}`;
  return (
    <div className="shrink-0 px-gutter pb-2 lg:px-0">
      <BuilderBar
        move={label}
        count={
          last === undefined
            ? 0
            : removalCount(state.graph, state.chapterId, last)
        }
        disabled={state.saving || state.stale}
        drawMode={state.drawMode}
        drawColor={state.drawColor}
        onRemove={onRemove}
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

/** The screen's state, its edits and the board's handlers. */
function useRepertoireScreen(props: RepertoireScreenProps) {
  const { repertoire } = props;
  const [state, dispatch] = useReducer(screenReducer, props, (p) =>
    initialState(p.graph, p.repertoire.version, p.chapterId ?? null),
  );
  const [ecoNames, setEcoNames] = useState(props.ecoNames);
  const edit = useEdit(repertoire.id, state, dispatch, setEcoNames);
  const board = useScreenBoard(state, repertoire.side);
  const addMove = useAddMove(state, edit, board.key);
  const play = useBoardPlay(
    state,
    dispatch,
    board,
    state.mode === 'build' ? addMove : null,
  );
  const drawing = useDrawing(state, dispatch, edit);
  const screen: Screen = { props, state, dispatch, edit, ecoNames };
  return { screen, board, play, drawing };
}

/**
 * The repertoire page (docs/design/repertoire-screen.md, section 2), browse
 * and builder: on a phone the top bar, board, board row and builder row
 * stay put and the panel scrolls below; on a desktop the board and the
 * panel sit side by side.
 */
export function RepertoireScreen(props: RepertoireScreenProps): JSX.Element {
  const { repertoire } = props;
  const { screen, board, play, drawing } = useRepertoireScreen(props);
  const { state, dispatch } = screen;
  const notes = useNotes(repertoire.id, props.notes);
  const words = useBoardWords(
    repertoire.name,
    state,
    board.view.fen,
    screen.ecoNames,
  );
  return (
    <main className="flex h-dvh flex-col lg:mx-auto lg:h-auto lg:max-w-6xl lg:gap-6 lg:px-gutter-wide lg:py-8">
      <RepertoireHeader id={repertoire.id} name={repertoire.name}>
        <ModeSwitch
          building={state.mode === 'build'}
          onChange={(building) => {
            dispatch({ type: 'mode', mode: building ? 'build' : 'browse' });
          }}
        />
      </RepertoireHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        <div className="shrink-0 lg:w-[min(calc(100dvh-12rem),42rem)]">
          <Board
            view={board.view}
            label={words.label}
            describe={words.describe}
            onMove={play.onMove}
            onSquare={drawing.onSquare}
            onShapes={drawing.onShapes}
            onEscape={drawing.onEscape}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:max-h-[calc(100dvh-12rem)] lg:w-panel lg:flex-none lg:rounded-card lg:bg-surface lg:p-4 lg:shadow-card">
          <BoardRow
            state={state}
            dispatch={dispatch}
            board={board}
            play={play}
          />
          <ScreenBuilderBar screen={screen} />
          <PanelStatus state={state} />
          <PanelBody screen={screen} notes={notes} />
        </div>
      </div>
      <Announcer state={state} />
      <p aria-live="polite" className="sr-only">
        {drawing.said}
      </p>
    </main>
  );
}
