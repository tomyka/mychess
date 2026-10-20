'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { importIntoRoute } from '../../../lib/routes';
import type {
  OwnerCoachNote,
  RepertoireSharing,
} from '../../../server/repertoires';
import { SECONDARY_BUTTON } from '../../buttons';
import {
  PANEL_LABEL,
  RepertoireShell,
  useBuilderView,
  useNotes,
  type Notes,
  type PanelContent,
  type RepertoireView,
} from '../../repertoire-view';
import { savePersonalNoteAction } from './actions';
import { BuilderBar } from './builder-bar';
import { ModeSwitch } from './mode-switch';
import { OwnerNotes } from './owner-notes';
import { RepertoireActions, RepertoireHeader } from './repertoire-header';
import { ShareWithCoach } from './share-with-coach';
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
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
  /** The chapter to open on; null or unknown opens the first. */
  readonly chapterId?: string | null;
  /** The owner's linked coaches and the shares (R-42). */
  readonly sharing: RepertoireSharing;
  /** Every coach's notes on it, read-only (R-107). */
  readonly coachNotes: readonly OwnerCoachNote[];
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
 * What the owner puts in the panel: the builder's chapter and comment
 * fields, the coaches' notes and the Personal note under each move, and the
 * repertoire's actions and sharing last.
 */
function ownerPanel(screen: Screen, notes: Notes): PanelContent {
  const { props, state, dispatch, edit } = screen;
  const { id, name } = props.repertoire;
  return {
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
        coachNotes={props.coachNotes.filter((n) => n.moveKey === key)}
        note={notes.byMove[key] ?? ''}
        onSaveNote={notes.save(key)}
      />
    ),
    notedMoves: notes.byMove,
    footer: (
      <>
        <PhoneActions id={id} name={name} />
        <ShareWithCoach repertoireId={id} sharing={props.sharing} />
      </>
    ),
  };
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
  const [ecoNames, setEcoNames] = useState(props.ecoNames);
  const editOf = (state: ScreenState, dispatch: Dispatch): Edit =>
    editor(repertoire.id, state, dispatch, setEcoNames);
  const view = useBuilderView(
    { graph, version: repertoire.version, chapterId },
    repertoire.side,
    (state, dispatch, from) => addMove(state, editOf(state, dispatch), from),
  );
  const { state, dispatch } = view;
  const edit = editOf(state, dispatch);
  const drawing = useDrawing(state, dispatch, edit);
  const screen: Screen = { props, state, dispatch, edit, ecoNames };
  return { screen, view, drawing };
}

/**
 * The repertoire page (docs/design/repertoire-screen.md, section 2), browse
 * and builder, on the repertoire-view shell.
 */
export function RepertoireScreen(props: RepertoireScreenProps): JSX.Element {
  const { repertoire } = props;
  const { screen, view, drawing } = useRepertoireScreen(props);
  const { state, dispatch } = screen;
  const notes = useNotes(props.notes, (moveKey, text) =>
    savePersonalNoteAction({ repertoireId: repertoire.id, moveKey, text }),
  );
  const router = useRouter();
  return (
    <RepertoireShell
      header={
        <RepertoireHeader id={repertoire.id} name={repertoire.name}>
          <ModeSwitch
            building={state.mode === 'build'}
            onChange={(building) => {
              dispatch({ type: 'mode', mode: building ? 'build' : 'browse' });
            }}
          />
        </RepertoireHeader>
      }
      name={repertoire.name}
      ecoNames={screen.ecoNames}
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
