'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import {
  coachPlayerPath,
  coachProgressPath,
} from '../../../../../../lib/routes';
import type { SharedRepertoirePage } from '../../../../../../server/coach-pages';
import {
  RepertoireTopBar,
  RepertoireShell,
  useBrowseView,
  useNotesByMove,
  type PanelContent,
} from '../../../../../repertoire-view';
import { CoachNoteForm } from './coach-note-form';

/**
 * The repertoire's header (spec, Header) as the coach has it: the way back
 * to the player and the name, no Edit and no More.
 */
function SharedTopBar({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  return (
    <RepertoireTopBar
      back={{
        href: coachPlayerPath(data.player.id),
        parent: data.player.displayName,
      }}
      name={data.repertoire.name}
    />
  );
}

/**
 * The coach's summary line, first in the panel as the player's is: the
 * player's name and the way to their progress on this repertoire (S7
 * decision 7).
 */
function SharedSummary({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('coach');
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-sm">
      {/* The back link already says the player's name to a screen reader. */}
      <span aria-hidden="true" className="text-fg-muted">
        {data.player.displayName}
      </span>
      <Link
        href={coachProgressPath(data.player.id, data.repertoire.id)}
        className="inline-flex min-h-touch items-center text-accent underline"
      >
        {t('progress.title')}
      </Link>
    </p>
  );
}

/** The coach's notes by move key, and a saver that keeps them current. */
function useCoachNotes(initial: Readonly<Record<string, string>>) {
  const notes = useNotesByMove(initial);
  return {
    byMove: notes.byMove,
    onChange:
      (key: string) =>
      (text: string): void => {
        notes.set(key, text);
      },
  };
}

/**
 * What the coach sees in the panel: the player's line, then under the move
 * list "read-only" by the coach's own note on the move, marked in the
 * move list.
 */
function useSharedPanel(data: SharedRepertoirePage): PanelContent {
  const t = useTranslations();
  const notes = useCoachNotes(data.notes);
  return {
    summary: { line: <SharedSummary data={data} /> },
    empty: (
      <p className="text-fg-muted">{t('repertoires.panel.emptyBrowse')}</p>
    ),
    notes: {
      byMove: notes.byMove,
      kind: 'coach',
      preface: (
        <p className="text-sm text-fg-muted">{t('coach.shared.readOnly')}</p>
      ),
      render: (key) => (
        <CoachNoteForm
          key={key}
          target={{
            playerId: data.player.id,
            repertoireId: data.repertoire.id,
            moveKey: key,
          }}
          playerName={data.player.displayName}
          initial={notes.byMove[key] ?? ''}
          onChange={notes.onChange(key)}
        />
      ),
    },
  };
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
  // A move the chapter lacks: the repertoire is the player's (R-42).
  const view = useBrowseView(
    data.graph,
    data.repertoire.side,
    'coach.shared.notInChapter',
  );
  const panel = useSharedPanel(data);
  return (
    <RepertoireShell
      topBar={<SharedTopBar data={data} />}
      name={data.repertoire.name}
      names={data.names}
      view={view}
      panel={panel}
    />
  );
}
