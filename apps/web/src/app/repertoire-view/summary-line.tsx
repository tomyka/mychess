import { percentLearned, type Standing } from '@mychess/chess';
import { assignmentBadges, daysBetween } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES, trainingPath } from '../../lib/routes';
import { AssignmentBadges } from '../assignment-badges';
import { COMPACT_TONAL } from '../buttons';
import { MasteredBadge } from '../mastered-badge';
import { TEXT_LINK } from '../settings/styles';
import { useStandingText } from '../standing-line';
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

/**
 * The share learned in the list card's words without the due part (Review
 * says it): "16% learned", "New · 15 moves" while no own move is started,
 * or Mastered as the pill (R-177, R-178).
 */
function Progress({
  standing,
  percent,
}: {
  readonly standing: Standing;
  readonly percent: number;
}): JSX.Element {
  // The standing line's words, with no due count.
  const text = useStandingText(standing, percent, 0);
  if (standing.mastered) return <MasteredBadge />;
  return <span className="text-sm text-fg-muted">{text}</span>;
}

/** The standing and its share learned, or null where there is none to show. */
function progressOf(
  standing: Standing | undefined,
): { readonly standing: Standing; readonly percent: number } | null {
  if (standing === undefined) return null;
  const percent = percentLearned(standing.counts);
  return percent === null ? null : { standing, percent };
}

/** Whether Review, Learn or the daily-limit line has anything to show. */
const hasTrainLinks = (training: PanelTraining | undefined): boolean =>
  training !== undefined &&
  (training.counts.due > 0 ||
    training.counts.toLearn > 0 ||
    training.limitReached);

/**
 * Review N and Learn N today (R-142, R-62), each only while its count is
 * above zero. Once today's new moves are used while moves are left, Learn
 * gives way to a line that says so and leads to the setting (decision 11).
 */
function TrainLinks({
  training,
}: {
  readonly training: PanelTraining;
}): JSX.Element {
  const t = useTranslations('repertoires.summary');
  const limit = useTranslations('training.repertoire');
  const { repertoireId, counts, limitReached } = training;
  return (
    <>
      {counts.due > 0 ? (
        <Link
          href={trainingPath('review', repertoireId)}
          className={COMPACT_TONAL}
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
          className={COMPACT_TONAL}
        >
          {t('learnToday', { count: counts.toLearn })}
        </Link>
      ) : null}
    </>
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
 * The summary's second line: who assigned it · its deadline, then the
 * Overdue and Paused pills. No urgency colour before the deadline (spec,
 * Assigned status strip).
 */
function StatusStrip({
  assignment,
}: {
  readonly assignment: SummaryAssignment;
}): JSX.Element {
  const t = useTranslations('repertoires.summary');
  const due = useDueText(assignment);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {/* One inline run, so " · " is spaced as in the text; the flex gap
          is only before the pills. */}
      <span>
        <span className="font-semibold">{assignment.coachName}</span>
        {due === null ? null : (
          <>
            <span aria-hidden="true" className="text-fg-muted">
              {t('separator')}
            </span>
            <span className="text-fg-muted">{due}</span>
          </>
        )}
      </span>
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

/** The share learned, then Review and Learn, on one wrapping row. */
function SummaryRow({
  progress,
  links,
}: {
  readonly progress: ReturnType<typeof progressOf>;
  readonly links: PanelTraining | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {progress === null ? null : (
        <Progress standing={progress.standing} percent={progress.percent} />
      )}
      {links === undefined ? null : <TrainLinks training={links} />}
    </div>
  );
}

/**
 * The summary row, first in the panel (spec, Summary row): the share
 * learned, then Review and Learn for a player who trains it, on one
 * wrapping row; on an assignment, the status strip as a second line. Side
 * and chapters are not repeated: the board and "Ch 1/6" say them. A paused
 * assignment keeps its share learned (R-222) but trains nothing (R-46):
 * its view passes the standing and no training. Nothing when there is
 * nothing to say, so the panel has no empty gap.
 */
export function SummaryLine({
  standing,
  training,
  assignment,
}: {
  /** The share learned; absent where the viewer does not train it. */
  readonly standing?: Standing | undefined;
  /** Review and Learn; absent also while paused. */
  readonly training?: PanelTraining | undefined;
  readonly assignment?: SummaryAssignment | undefined;
}): JSX.Element | null {
  const progress = progressOf(standing);
  const links = hasTrainLinks(training) ? training : undefined;
  const row = progress !== null || links !== undefined;
  if (!row && assignment === undefined) return null;
  return (
    <div className="flex flex-col gap-1">
      {row ? <SummaryRow progress={progress} links={links} /> : null}
      {assignment === undefined ? null : (
        <StatusStrip assignment={assignment} />
      )}
    </div>
  );
}
