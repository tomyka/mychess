import { percentLearned, type Side, type Standing } from '@mychess/chess';
import { assignmentBadges, daysBetween } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES, trainingPath } from '../../lib/routes';
import { AssignmentBadges } from '../assignment-badges';
import { TONAL_BUTTON } from '../buttons';
import { TEXT_LINK } from '../settings/styles';
import { noonOf, useShortDeadline } from '../use-deadline';
import type { PanelTraining } from './panel-training';

/** What the assigned view's status strip says (spec, Header). */
export interface SummaryAssignment {
  readonly coachName: string;
  /** The effective deadline, `YYYY-MM-DD`, or null (R-16). */
  readonly deadline: string | null;
  /** The page's day, `YYYY-MM-DD` in Vilnius, read on the server. */
  readonly today: string;
  /** Decided by the domain as of the page load (R-51). */
  readonly overdue: boolean;
  readonly paused: boolean;
}

/** Side, chapters and, for a player who trains it, the share learned. */
function Facts({
  side,
  chapters,
  standing,
}: {
  readonly side: Side;
  readonly chapters: number;
  readonly standing: Standing | undefined;
}): JSX.Element {
  const t = useTranslations('repertoires.summary');
  const percent =
    standing === undefined ? null : percentLearned(standing.counts);
  return (
    <p className="text-sm text-fg-muted">
      {percent === null
        ? t('factsNoProgress', { side, chapters })
        : t('facts', { side, chapters, percent })}
    </p>
  );
}

/**
 * Review N and Learn N today (R-142, R-62), each only while its count is
 * above zero. Once today's new moves are used while moves are left, Learn
 * gives way to a line that says so and leads to the setting (decision 11).
 */
function TrainLinks({
  training,
}: {
  readonly training: PanelTraining;
}): JSX.Element | null {
  const t = useTranslations('repertoires.summary');
  const limit = useTranslations('training.repertoire');
  const { repertoireId, counts, limitReached } = training;
  if (counts.due === 0 && counts.toLearn === 0 && !limitReached) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {counts.due > 0 ? (
        <Link
          href={trainingPath('review', repertoireId)}
          className={TONAL_BUTTON}
        >
          {t('review', { count: counts.due })}
        </Link>
      ) : null}
      {limitReached ? (
        <p className="text-sm text-fg-muted">
          {limit('limitReached', { count: training.learn.limits.newPerDay })}{' '}
          <Link href={ROUTES.trainingSettings} className={TEXT_LINK}>
            {limit('limitSettings')}
          </Link>
        </p>
      ) : null}
      {!limitReached && counts.toLearn > 0 ? (
        <Link
          href={trainingPath('learn', repertoireId)}
          className={TONAL_BUTTON}
        >
          {t('learnToday', { count: counts.toLearn })}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * "due Nov 30 · in 4 days" or "due today"; nothing without a deadline or
 * once overdue, where the Overdue pill says it instead (spec, Header).
 */
function useDueText(assignment: SummaryAssignment): string | null {
  const t = useTranslations('repertoires.summary');
  const date = useShortDeadline(assignment.today);
  const { deadline, today, overdue } = assignment;
  if (deadline === null || overdue) return null;
  const days = daysBetween(noonOf(today), noonOf(deadline));
  return days === 0
    ? t('dueToday')
    : t('dueIn', { date: date(deadline), days });
}

/**
 * Who assigned it and its deadline, then the Overdue and Paused pills. No
 * urgency colour before the deadline (spec, Header).
 */
function StatusStrip({
  assignment,
}: {
  readonly assignment: SummaryAssignment;
}): JSX.Element {
  const due = useDueText(assignment);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-semibold">{assignment.coachName}</span>
      {due === null ? null : <span className="text-fg-muted">{due}</span>}
      <AssignmentBadges
        flags={assignmentBadges({
          audience: 'player',
          opened: true,
          overdue: assignment.overdue,
          paused: assignment.paused,
        })}
      />
    </div>
  );
}

/**
 * The line under the repertoire's name (spec, Header): side, chapters and
 * the share learned; Review and Learn for a player who trains it; on an
 * assignment, the status strip. A paused assignment keeps its share
 * learned (R-222) but trains nothing (R-46): its view passes the standing
 * and no training.
 */
export function SummaryLine({
  side,
  chapters,
  standing,
  training,
  assignment,
}: {
  readonly side: Side;
  readonly chapters: number;
  /** The share learned; absent where the viewer does not train it, and in the builder. */
  readonly standing?: Standing | undefined;
  /** Review and Learn; absent also while paused. */
  readonly training?: PanelTraining | undefined;
  readonly assignment?: SummaryAssignment | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Facts side={side} chapters={chapters} standing={standing} />
      {training === undefined ? null : <TrainLinks training={training} />}
      {assignment === undefined ? null : (
        <StatusStrip assignment={assignment} />
      )}
    </div>
  );
}
