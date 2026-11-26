'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, type JSX } from 'react';
import type { MessageKey } from '../../../../i18n/message-key';
import {
  assignedForkRoute,
  assignedManageRoute,
  ROUTES,
} from '../../../../lib/routes';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import type { RepertoireTraining } from '../../../../server/training';
import { SECONDARY_BUTTON } from '../../../buttons';
import {
  PersonalNote,
  RepertoireShell,
  RepertoireTopBar,
  SummaryLine,
  useBrowseView,
  useNotes,
  type Notes,
  type PanelContent,
  type RepertoireView,
  type ScreenMessage,
} from '../../../repertoire-view';
import { markSeenAction, setPersonalNoteAction } from './actions';
import { ChangesSummary } from './changes-summary';

/** What the board says for a move the chapter lacks: the coach's to change. */
const NOT_IN_CHAPTER: MessageKey = 'assignment.notInChapter';

/**
 * Beside "this is your coach's repertoire" (#320): the way to a Fork, a
 * copy the player can change, on the Repertoire screen with its question
 * open. Not a Fork offer (R-44, R-130), which follows an unlink.
 */
function ForkLink({ id }: { readonly id: string }): JSX.Element {
  const t = useTranslations('assignment.fork');
  return (
    <Link
      href={assignedForkRoute(id)}
      className={`${SECONDARY_BUTTON} self-start`}
    >
      {t('label')}
    </Link>
  );
}

/** The header (spec, Header): back to Repertoires, the name and More. */
function AssignedTopBar({
  data,
}: {
  readonly data: AssignedRepertoirePage;
}): JSX.Element {
  const t = useTranslations('nav');
  const { id, name } = data.repertoire;
  return (
    <RepertoireTopBar
      back={{ href: ROUTES.repertoires, parent: t('repertoires') }}
      name={name}
      moreHref={assignedManageRoute(id)}
    />
  );
}

interface AssignedViewProps {
  readonly data: AssignedRepertoirePage;
  /** The page's day, `YYYY-MM-DD` in Vilnius, for the days left. */
  readonly today: string;
  /**
   * The player's training of it, as the page loaded (R-142, R-206): its
   * loader gives its progress but nothing to train while paused (R-46,
   * R-228).
   */
  readonly training?: RepertoireTraining | null;
}

/**
 * The summary line, first in the panel, and the status strip: who
 * assigned it, its deadline and badges.
 */
function AssignedSummary({
  props: { data, today, training },
  state,
}: {
  readonly props: AssignedViewProps;
  readonly state: RepertoireView['state'];
}): JSX.Element {
  return (
    <SummaryLine
      training={training ?? undefined}
      state={state}
      assignment={{
        coachName: data.coachName,
        deadline: data.deadline,
        today,
        overdue: data.overdue,
        paused: data.paused,
      }}
    />
  );
}

/**
 * What the player sees in the panel: the summary line, what changed since
 * the last visit, the coach's comments as coach notes (R-102) and the
 * player's own note under each (R-21).
 */
function useAssignedPanel(
  props: AssignedViewProps,
  notes: Notes,
  state: RepertoireView['state'],
): PanelContent {
  const t = useTranslations();
  const { data } = props;
  return {
    summary: {
      line: <AssignedSummary props={props} state={state} />,
      changes: (
        <ChangesSummary
          graph={data.graph}
          changes={data.changes}
          names={data.names}
        />
      ),
    },
    training: props.training,
    empty: (
      <p className="text-fg-muted">{t('repertoires.panel.emptyBrowse')}</p>
    ),
    comment: { label: t('coachNote.byCoach', { name: data.coachName }) },
    notes: {
      byMove: notes.byMove,
      render: (key) => (
        <PersonalNote
          key={key}
          initial={notes.byMove[key] ?? ''}
          onSaveNote={notes.save(key)}
        />
      ),
    },
  };
}

/**
 * A repertoire the player has from their coach (R-15, R-21): the board,
 * chapters and moves read-only, the coach's comments and the player's own
 * notes. Pause, Download PGN and "make my own copy" are on its Repertoire
 * screen (R-226). Opening it marks the version shown seen, so "Updated"
 * and the summary show once (R-133).
 */
export function AssignedView(props: AssignedViewProps): JSX.Element {
  const { data } = props;
  const { id, version } = data.repertoire;
  const view = useBrowseView(data.graph, data.repertoire.side, NOT_IN_CHAPTER);
  const notes = useNotes(data.notes, (moveKey, text) =>
    setPersonalNoteAction({ repertoireId: id, moveKey, text }),
  );
  const panel = useAssignedPanel(props, notes, view.state);
  useEffect(() => {
    markSeenAction({ repertoireId: id, seenVersion: version }).catch(
      () => undefined,
    );
  }, [id, version]);
  return (
    <RepertoireShell
      topBar={<AssignedTopBar data={data} />}
      name={data.repertoire.name}
      names={data.names}
      view={view}
      panel={panel}
      statusAction={(message: ScreenMessage) =>
        message.key === NOT_IN_CHAPTER ? <ForkLink id={id} /> : null
      }
    />
  );
}
