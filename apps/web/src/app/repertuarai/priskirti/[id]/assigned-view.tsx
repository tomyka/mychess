'use client';

import { assignmentBadges } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import { useEffect, type JSX } from 'react';
import { ROUTES } from '../../../../lib/routes';
import type { TrainingCounts } from '@mychess/chess';
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
import { AssignmentBadges } from '../../../assignment-badges';
import { useDeadline } from '../../../use-deadline';
import { PauseControl, usePause, type PauseHandle } from './pause-control';

/**
 * The way home, the repertoire's name, who assigned it, its deadline and
 * badges (docs/design/coach-shared-repertoire.md's top bar).
 */
function AssignedHeader({
  data,
  paused,
}: {
  readonly data: AssignedRepertoirePage;
  /** The pause as it is now, which may have changed since the page loaded. */
  readonly paused: boolean;
}): JSX.Element {
  const t = useTranslations('assignment');
  const date = useDeadline();
  const { deadline } = data;
  return (
    <HeaderFrame>
      <BackLink href={ROUTES.home} label={t('page.back')} />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-none">
        <h1
          title={data.repertoire.name}
          className="truncate text-lg font-semibold lg:whitespace-normal lg:text-3xl lg:font-bold"
        >
          {data.repertoire.name}
        </h1>
        <p className="truncate text-sm text-fg-muted">
          {t('page.assignedBy', { name: data.coachName })}
        </p>
        {deadline === null ? null : (
          <p className="text-sm">{t('deadlineOn', { date: date(deadline) })}</p>
        )}
        <AssignmentBadges
          flags={assignmentBadges({
            audience: 'player',
            opened: true,
            overdue: data.overdue,
            paused,
          })}
        />
      </div>
    </HeaderFrame>
  );
}

/** Pause or resume, then "make my own copy". */
function AssignmentActions({
  data,
  pause,
  forkAction,
}: {
  readonly data: AssignedRepertoirePage;
  readonly pause: PauseHandle;
  readonly forkAction: ForkAction;
}): JSX.Element {
  const { id, name } = data.repertoire;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <PauseControl repertoireId={id} pause={pause} />
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
  actions: { readonly pause: PauseHandle; readonly forkAction: ForkAction },
  training: TrainingCounts | null,
): PanelContent {
  const t = useTranslations();
  // A paused assignment trains nothing new (R-46): no train buttons and no
  // "I know this"; the pause control says why.
  const trains = training !== null && !actions.pause.state.paused;
  return {
    training: trains
      ? { repertoireId: data.repertoire.id, counts: training }
      : undefined,
    lead: (
      <ChangesSummary
        graph={data.graph}
        changes={data.changes}
        names={data.names}
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
    footer: <AssignmentActions data={data} {...actions} />,
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
  training = null,
}: {
  readonly data: AssignedRepertoirePage;
  readonly forkAction: ForkAction;
  /** The player's due and to-learn counts of it, as the page loaded. */
  readonly training?: TrainingCounts | null;
}): JSX.Element {
  const { id, version } = data.repertoire;
  const view = useBrowseView(data.graph, data.repertoire.side);
  const notes = useNotes(data.personalNotes, (moveKey, text) =>
    setPersonalNoteAction({ repertoireId: id, moveKey, text }),
  );
  const pause = usePause(data.paused);
  const panel = useAssignedPanel(data, notes, { pause, forkAction }, training);
  useEffect(() => {
    markSeenAction({ repertoireId: id, seenVersion: version }).catch(
      () => undefined,
    );
  }, [id, version]);
  return (
    <RepertoireShell
      header={<AssignedHeader data={data} paused={pause.state.paused} />}
      name={data.repertoire.name}
      names={data.names}
      view={view}
      panel={panel}
    />
  );
}
