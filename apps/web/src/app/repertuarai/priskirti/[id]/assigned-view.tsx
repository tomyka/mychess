'use client';

import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { ROUTES } from '../../../../lib/routes';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import {
  BackLink,
  HeaderFrame,
  PersonalNote,
  RepertoireShell,
  useBrowseView,
  useNotes,
  type Notes,
  type PanelContent,
} from '../../../repertoire-view';
import { markSeenAction, setPersonalNoteAction } from './actions';
import { ChangesSummary } from './changes-summary';
import { ForkCopy, type ForkAction } from './fork-copy';
import { PauseControl } from './pause-control';

/**
 * The way home, the repertoire's name and who assigned it
 * (docs/design/coach-shared-repertoire.md's top bar).
 */
function AssignedHeader({
  data,
}: {
  readonly data: AssignedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('assignment.page');
  return (
    <HeaderFrame>
      <BackLink href={ROUTES.home} label={t('back')} />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-none">
        <h1
          title={data.repertoire.name}
          className="truncate text-lg font-semibold lg:whitespace-normal lg:text-3xl lg:font-bold"
        >
          {data.repertoire.name}
        </h1>
        <p className="truncate text-sm text-fg-muted">
          {t('assignedBy', { name: data.coachName })}
        </p>
      </div>
    </HeaderFrame>
  );
}

/** Pause or resume, then "make my own copy". */
function AssignmentActions({
  data,
  forkAction,
}: {
  readonly data: AssignedRepertoirePage;
  readonly forkAction: ForkAction;
}): JSX.Element {
  const { id, name } = data.repertoire;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <PauseControl repertoireId={id} paused={data.paused} />
      <ForkCopy repertoireId={id} name={name} action={forkAction} />
    </div>
  );
}

/**
 * What the player sees in the panel: what changed since the last visit,
 * the coach's comments as coach notes (R-102), the player's own note under
 * each (R-21), and the assignment's actions last.
 */
function useAssignedPanel(
  data: AssignedRepertoirePage,
  notes: Notes,
  forkAction: ForkAction,
): PanelContent {
  const t = useTranslations();
  return {
    lead: (
      <ChangesSummary
        graph={data.graph}
        changes={data.changes}
        ecoNames={data.ecoNames}
      />
    ),
    empty: (
      <p className="text-fg-muted">{t('repertoires.panel.emptyBrowse')}</p>
    ),
    commentLabel: t('coachNote.byCoach', { name: data.coachName }),
    renderNotes: (key) => (
      <PersonalNote
        key={key}
        initial={notes.byMove[key] ?? ''}
        onSaveNote={notes.save(key)}
      />
    ),
    notedMoves: notes.byMove,
    footer: <AssignmentActions data={data} forkAction={forkAction} />,
  };
}

/**
 * A repertoire the player has from their coach (R-15, R-21): the board,
 * chapters and moves read-only, the coach's comments, the player's own
 * notes, pause and "make my own copy". Opening it marks the version shown
 * seen, so "Updated" and the summary show once (R-133). `forkAction`: the
 * fork's server action.
 */
export function AssignedView({
  data,
  forkAction,
}: {
  readonly data: AssignedRepertoirePage;
  readonly forkAction: ForkAction;
}): JSX.Element {
  const { id, version } = data.repertoire;
  const view = useBrowseView(data.graph, data.repertoire.side);
  const notes = useNotes(data.personalNotes, (moveKey, text) =>
    setPersonalNoteAction({ repertoireId: id, moveKey, text }),
  );
  const panel = useAssignedPanel(data, notes, forkAction);
  useEffect(() => {
    markSeenAction({ repertoireId: id, seenVersion: version }).catch(
      () => undefined,
    );
  }, [id, version]);
  return (
    <RepertoireShell
      header={<AssignedHeader data={data} />}
      name={data.repertoire.name}
      ecoNames={data.ecoNames}
      view={view}
      panel={panel}
    />
  );
}
