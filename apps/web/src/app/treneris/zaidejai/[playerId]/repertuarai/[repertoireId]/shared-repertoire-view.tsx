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
  BackLink,
  HeaderFrame,
  RepertoireShell,
  useBrowseView,
  useNotesByMove,
  type PanelContent,
} from '../../../../../repertoire-view';
import { CoachNoteForm } from './coach-note-form';

/**
 * The way back to the player and the repertoire's name: on a phone one top
 * bar (back, the name, the player's name under it) so the board stays high;
 * on a desktop the back link spelled out over the name
 * (docs/design/coach-shared-repertoire.md). Then the way to the player's
 * progress on this repertoire (S7 decision 7).
 */
function SharedHeader({
  data,
}: {
  readonly data: SharedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('coach');
  return (
    <HeaderFrame>
      <BackLink
        href={coachPlayerPath(data.player.id)}
        label={t('shared.back', { name: data.player.displayName })}
      />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-none">
        <h1
          title={data.repertoire.name}
          className="truncate text-lg font-semibold lg:whitespace-normal lg:text-3xl lg:font-bold"
        >
          {data.repertoire.name}
        </h1>
        <p
          aria-hidden="true"
          className="truncate text-sm text-fg-muted lg:hidden"
        >
          {data.player.displayName}
        </p>
      </div>
      <Link
        href={coachProgressPath(data.player.id, data.repertoire.id)}
        className="inline-flex min-h-touch shrink-0 items-center text-accent underline"
      >
        {t('progress.title')}
      </Link>
    </HeaderFrame>
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
 * What the coach sees in the panel: "read-only" over the chapters, the
 * coach's own note under each move's comment, marked in the move list.
 */
function useSharedPanel(data: SharedRepertoirePage): PanelContent {
  const t = useTranslations();
  const notes = useCoachNotes(data.notes);
  return {
    lead: <p className="text-sm text-fg-muted">{t('coach.shared.readOnly')}</p>,
    empty: (
      <p className="text-fg-muted">{t('repertoires.panel.emptyBrowse')}</p>
    ),
    renderNotes: (key) => (
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
    notedMoves: notes.byMove,
    noteKind: 'coach',
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
  const view = useBrowseView(data.graph, data.repertoire.side);
  const panel = useSharedPanel(data);
  return (
    <RepertoireShell
      header={<SharedHeader data={data} />}
      name={data.repertoire.name}
      names={data.names}
      view={view}
      panel={panel}
    />
  );
}
