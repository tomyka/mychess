'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import type { ChapterNames } from '../../../lib/chapter-label';
import {
  importIntoRoute,
  repertoireManageRoute,
  ROUTES,
} from '../../../lib/routes';
import type { ForkNote, OwnerCoachNote } from '../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../buttons';
import {
  RepertoireShell,
  RepertoireTopBar,
  SummaryLine,
  useBuilderView,
  useNotes,
  type MoveCoachNote,
  type Notes,
  type PanelContent,
  type PanelTraining,
  type RepertoireView,
} from '../../repertoire-view';
import { savePersonalNoteAction } from './actions';
import { BuilderBar } from './builder-bar';
import { ModeSwitch } from './mode-switch';
import { OwnerNotes } from './owner-notes';
import {
  addMove,
  chapterBuilder,
  commentEditor,
  editor,
  removalTarget,
  useDrawing,
  useRemoveMove,
  type Edit,
} from './use-builder';

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
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  /** The chapter to open on; null or unknown opens the first. */
  readonly chapterId?: string | null;
  /** Every coach's notes on it, read-only (R-107). */
  readonly coachNotes: readonly OwnerCoachNote[];
  /** On a fork, the notes it kept from the coach who assigned it (R-47). */
  readonly forkNotes: readonly ForkNote[];
  /** The owner's training of it (R-142); null when they do not train it. */
  readonly training?: PanelTraining | null;
}

type ScreenState = RepertoireView['state'];
type Dispatch = RepertoireView['dispatch'];

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
  const browsing = mode === 'browse';
  return (
    <div className="flex flex-col gap-3">
      <p className={browsing ? 'text-fg-muted' : undefined}>
        {t(browsing ? 'panel.emptyBrowse' : 'panel.emptyBuild')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={importIntoRoute(id)} className={SECONDARY_BUTTON}>
          {t('manage.importInto')}
        </Link>
        {browsing ? (
          <button type="button" onClick={onBuild} className={SECONDARY_BUTTON}>
            {t('mode.toBuild')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The screen's state and what changes it, as the panel's parts need them. */
interface Screen {
  readonly props: RepertoireScreenProps;
  readonly state: ScreenState;
  readonly dispatch: Dispatch;
  readonly edit: Edit;
  /** What titles the chapters, as of the last save (R-158). */
  readonly names: ChapterNames;
}

/**
 * The coaches' notes on one move, read-only: the one a fork kept from its
 * coach first (no account: that coach may be gone, R-49), then each sharing
 * coach's.
 */
function coachNotesOn(
  props: RepertoireScreenProps,
  key: string,
): MoveCoachNote[] {
  return [
    ...props.forkNotes
      .filter((note) => note.moveKey === key)
      .map(({ coachName, text }) => ({ coachId: null, coachName, text })),
    ...props.coachNotes.filter((note) => note.moveKey === key),
  ];
}

/**
 * What the owner puts in the panel: the builder's chapter and comment
 * fields, and the coaches' notes and the Personal note under each move.
 * The repertoire's actions are on its Repertoire screen (R-226).
 */
function ownerPanel(screen: Screen, notes: Notes): PanelContent {
  const { props, state, dispatch, edit } = screen;
  const { id } = props.repertoire;
  return {
    summary: <OwnerSummary screen={screen} />,
    chapterBuilder: chapterBuilder(state, edit),
    empty: (
      <EmptyRepertoire
        id={id}
        mode={state.mode}
        onBuild={() => {
          dispatch({ type: 'mode', mode: 'build' });
        }}
      />
    ),
    commentEditor: commentEditor(state, edit),
    renderNotes: (key) => (
      <OwnerNotes
        key={key}
        coachNotes={coachNotesOn(props, key)}
        note={notes.byMove[key] ?? ''}
        onSaveNote={notes.save(key)}
      />
    ),
    training: props.training ?? undefined,
    notedMoves: notes.byMove,
    keptNoteMoves: new Set(props.forkNotes.map((note) => note.moveKey)),
  };
}

/**
 * The summary row, first in the panel: the share learned, Review and
 * Learn. None in the builder or in an empty repertoire (spec, Summary row).
 */
function OwnerSummary({
  screen,
}: {
  readonly screen: Screen;
}): JSX.Element | null {
  const { props, state } = screen;
  const training = props.training ?? undefined;
  if (state.mode === 'build' || state.graph.chapters.length === 0) return null;
  return <SummaryLine standing={training?.standing} training={training} />;
}

/** The page's header (spec, Header): back to Repertoires, the name, Edit and More. */
function OwnerTopBar({ screen }: { readonly screen: Screen }): JSX.Element {
  const { props, state, dispatch } = screen;
  const { id, name } = props.repertoire;
  const t = useTranslations('nav');
  const building = state.mode === 'build';
  return (
    <RepertoireTopBar
      back={{ href: ROUTES.repertoires, parent: t('repertoires') }}
      name={name}
      edit={
        <ModeSwitch
          building={building}
          onChange={(on) => {
            dispatch({ type: 'mode', mode: on ? 'build' : 'browse' });
          }}
        />
      }
      moreHref={repertoireManageRoute(id)}
    />
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
  const { move, count } = removalTarget(state);
  return (
    <div className="shrink-0 px-gutter pb-2 lg:px-0">
      <BuilderBar
        move={move}
        count={count}
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
  const { repertoire, graph, chapterId } = props;
  const [names, setNames] = useState(props.names);
  const editOf = (state: ScreenState, dispatch: Dispatch): Edit =>
    editor(repertoire.id, state, dispatch, setNames);
  const view = useBuilderView(
    { graph, version: repertoire.version, chapterId },
    repertoire.side,
    (state, dispatch, from) => addMove(state, editOf(state, dispatch), from),
  );
  const { state, dispatch } = view;
  const edit = editOf(state, dispatch);
  const drawing = useDrawing(state, dispatch, edit);
  const screen: Screen = { props, state, dispatch, edit, names };
  return { screen, view, drawing };
}

/**
 * The repertoire page (docs/design/repertoire-screen.md, section 2), browse
 * and builder, on the repertoire-view shell.
 */
export function RepertoireScreen(props: RepertoireScreenProps): JSX.Element {
  const { repertoire } = props;
  const { screen, view, drawing } = useRepertoireScreen(props);
  const notes = useNotes(props.notes, (moveKey, text) =>
    savePersonalNoteAction({ repertoireId: repertoire.id, moveKey, text }),
  );
  const router = useRouter();
  return (
    <RepertoireShell
      topBar={<OwnerTopBar screen={screen} />}
      name={repertoire.name}
      names={screen.names}
      view={view}
      panel={ownerPanel(screen, notes)}
      drawing={drawing}
      toolbar={<ScreenBuilderBar screen={screen} />}
      onReload={() => {
        router.refresh();
      }}
    />
  );
}
