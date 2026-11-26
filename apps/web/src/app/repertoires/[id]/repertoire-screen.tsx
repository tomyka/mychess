'use client';

import type { RepertoireGraph, Side } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';
import type { ChapterNames } from '../../../lib/chapter-label';
import {
  importIntoRoute,
  repertoireManageRoute,
  ROUTES,
} from '../../../lib/routes';
import type { ForkNote, OwnerCoachNote } from '../../../server/repertoires';
import type { RepertoireTraining } from '../../../server/training';
import { SECONDARY_BUTTON } from '../../buttons';
import {
  RepertoireShell,
  RepertoireTopBar,
  SummaryLine,
  useNotes,
  useRepertoireBuilder,
  type MoveCoachNote,
  type Notes,
  type PanelContent,
  type RepertoireBuilder,
} from '../../repertoire-view';
import { editRepertoireAction, savePersonalNoteAction } from './actions';
import { ModeSwitch } from './mode-switch';
import { OwnerNotes } from './owner-notes';

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
  readonly training?: RepertoireTraining | null;
}

/** A repertoire without chapters: play the first move, or add games from PGN. */
function EmptyRepertoire({
  id,
  building,
  onBuild,
}: {
  readonly id: string;
  readonly building: boolean;
  readonly onBuild: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  const browsing = !building;
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
function ownerPanel(
  props: RepertoireScreenProps,
  builder: RepertoireBuilder,
  notes: Notes,
): PanelContent {
  return {
    ...builder.panel,
    summary: (
      <SummaryLine
        training={props.training ?? undefined}
        state={builder.view.state}
      />
    ),
    empty: (
      <EmptyRepertoire
        id={props.repertoire.id}
        building={builder.building}
        onBuild={() => {
          builder.setBuilding(true);
        }}
      />
    ),
    renderNotes: (key) => (
      <OwnerNotes
        key={key}
        coachNotes={coachNotesOn(props, key)}
        note={notes.byMove[key] ?? ''}
        onSaveNote={notes.save(key)}
      />
    ),
    training: props.training,
    notedMoves: notes.byMove,
    keptNoteMoves: new Set(props.forkNotes.map((note) => note.moveKey)),
  };
}

/** The page's header (spec, Header): back to Repertoires, the name, Edit and More. */
function OwnerTopBar({
  repertoire,
  builder,
}: {
  readonly repertoire: RepertoireScreenProps['repertoire'];
  readonly builder: RepertoireBuilder;
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <RepertoireTopBar
      back={{ href: ROUTES.repertoires, parent: t('repertoires') }}
      name={repertoire.name}
      edit={
        <ModeSwitch
          building={builder.building}
          onChange={builder.setBuilding}
        />
      }
      moreHref={repertoireManageRoute(repertoire.id)}
    />
  );
}

/**
 * The repertoire page (docs/design/repertoire-screen.md, section 2), browse
 * and builder, on the repertoire-view shell: the builder gets the page's
 * edit action as its save; the page adds its header and the notes.
 */
export function RepertoireScreen(props: RepertoireScreenProps): JSX.Element {
  const { repertoire } = props;
  const builder = useRepertoireBuilder({
    graph: props.graph,
    version: repertoire.version,
    side: repertoire.side,
    chapterId: props.chapterId,
    names: props.names,
    save: (edit) =>
      editRepertoireAction({ repertoireId: repertoire.id, ...edit }),
  });
  const notes = useNotes(props.notes, (moveKey, text) =>
    savePersonalNoteAction({ repertoireId: repertoire.id, moveKey, text }),
  );
  const router = useRouter();
  return (
    <RepertoireShell
      topBar={<OwnerTopBar repertoire={repertoire} builder={builder} />}
      name={repertoire.name}
      names={builder.names}
      view={builder.view}
      panel={ownerPanel(props, builder, notes)}
      drawing={builder.drawing}
      toolbar={builder.toolbar}
      onReload={() => {
        router.refresh();
      }}
    />
  );
}
