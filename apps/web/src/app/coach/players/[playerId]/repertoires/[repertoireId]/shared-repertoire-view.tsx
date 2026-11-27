'use client';

import { moveKey } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import {
  coachPlayerPath,
  coachProgressPath,
} from '../../../../../../lib/routes';
import type { SharedRepertoirePage } from '../../../../../../server/coach-pages';
import {
  moveLabel,
  RepertoireTopBar,
  RepertoireShell,
  useBrowseView,
  useNotesByMove,
  type PanelContent,
  type RepertoireView,
} from '../../../../../repertoire-view';
import { useOwnCopyTitle } from '../../../../own-copy-title';
import { CoachNoteCard } from './coach-note-card';
import { CoachNoteStrip } from './coach-note-strip';

/**
 * The repertoire's header as the coach has it (docs/design/
 * coach-shared-repertoire.md, Height budget): back to the player and
 * Progress on one row, the name with "Shared with you · read-only" under
 * it. No Edit and no More.
 */
function SharedTopBar({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('coach');
  const title = useOwnCopyTitle({
    isFork: data.isFork,
    playerName: data.player.displayName,
    repertoireName: data.repertoire.name,
  });
  return (
    <RepertoireTopBar
      back={{
        href: coachPlayerPath(data.player.id),
        parent: data.player.displayName,
      }}
      name={title}
      tag={t('shared.tag')}
      edit={
        <Link
          href={coachProgressPath(data.player.id, data.repertoire.id)}
          className="inline-flex min-h-touch items-center text-sm text-accent underline"
        >
          {t('progress.title')}
        </Link>
      }
    />
  );
}

/** The coach's notes by move key, and a saver that keeps them current. */
type CoachNotes = ReturnType<typeof useNotesByMove>;

/**
 * The coach's own note on the current move, under its comment: a card
 * from `lg`, a one-line strip below it. None at a chapter root or out of
 * a chapter: a coach note belongs to a move.
 */
function MoveCoachNote({
  data,
  view,
  notes,
}: {
  readonly data: SharedRepertoirePage;
  readonly view: RepertoireView;
  readonly notes: CoachNotes;
}): JSX.Element | null {
  const { state } = view;
  const move = state.path.at(-1);
  if (state.chapterId === null || move === undefined) return null;
  const key = moveKey(move.from, move.san);
  const props = {
    target: {
      playerId: data.player.id,
      repertoireId: data.repertoire.id,
      moveKey: key,
    },
    note: notes.byMove[key] ?? '',
    onChange: (text: string) => {
      notes.set(key, text);
    },
    move: moveLabel(state.graph, state.chapterId, state.path, move),
    playerName: data.player.displayName,
  };
  // Keyed by move: stepping drops an edit in progress.
  return (
    <>
      <CoachNoteCard key={`card ${key}`} {...props} />
      <CoachNoteStrip key={`strip ${key}`} {...props} />
    </>
  );
}

/**
 * What the coach sees in the panel: the chapters and the moves, the pen
 * on the moves carrying the coach's own note. The note itself sits under
 * the comment strip (MoveCoachNote), not here.
 */
function useSharedPanel(notes: CoachNotes): PanelContent {
  const t = useTranslations();
  return {
    empty: (
      <p className="text-fg-muted">{t('repertoires.panel.emptyBrowse')}</p>
    ),
    notes: { byMove: notes.byMove, kind: 'coach' },
  };
}

/**
 * A player's repertoire as the coach it is shared with sees it (R-42):
 * the board, chapters, moves, comments (R-102) and the coach's own notes
 * (R-125), with nothing that changes the repertoire. Laid out as the
 * owner's repertoire page (docs/design/repertoire-screen.md), with room
 * under the comment for the note.
 */
export function SharedRepertoireView({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  // A move the chapter lacks: the repertoire is the player's (R-42).
  const view = useBrowseView(
    data.graph,
    data.repertoire.side,
    'coach.shared.notInChapter',
  );
  const notes = useNotesByMove(data.notes);
  const panel = useSharedPanel(notes);
  return (
    <RepertoireShell
      topBar={<SharedTopBar data={data} />}
      name={data.repertoire.name}
      names={data.names}
      view={view}
      panel={panel}
      underComment={<MoveCoachNote data={data} view={view} notes={notes} />}
      panelBasis="noteStrip"
    />
  );
}
