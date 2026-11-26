import { percentLearned, type Standing } from '@mychess/chess';
import { assignmentBadges, daysBetween } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX } from 'react';
import { ROUTES, trainingPath } from '../../lib/routes';
import { AssignmentBadges } from '../assignment-badges';
import { COMPACT_TONAL } from '../buttons';
import { TEXT_LINK } from '../settings/styles';
import { StandingLine } from '../standing-line';
import { noonOf, useShortDeadline } from '../use-deadline';
import type { RepertoireTraining, TrainNow } from '../../server/training';
import type { ScreenState } from './screen-state';

/** What of the view decides whether there is a row: its mode and chapters. */
type SummaryState = Pick<ScreenState, 'mode' | 'graph'>;

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

/** Whether there is a share learned to show: a standing with own moves. */
const hasProgress = (standing: Standing | undefined): standing is Standing =>
  standing !== undefined && percentLearned(standing.counts) !== null;

/** Whether Review, Learn or the daily-limit line has anything to show. */
const hasTrainLinks = (training: TrainNow | undefined): boolean =>
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
  readonly training: TrainNow;
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

/**
 * The share learned in the list card's words, with no bar and no due part
 * (Review says it), then Review and Learn, on one wrapping row.
 */
function SummaryRow({
  standing,
  links,
}: {
  readonly standing: Standing | undefined;
  readonly links: TrainNow | undefined;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {standing === undefined ? null : (
        <StandingLine standing={standing} due={0} bar={false} />
      )}
      {links === undefined ? null : <TrainLinks training={links} />}
    </div>
  );
}

/** What the row shows: the share learned and the train links, each if any. */
interface RowParts {
  readonly standing: Standing | undefined;
  readonly links: TrainNow | undefined;
}

/**
 * The row's parts. Builder mode and an empty repertoire have no row (spec,
 * Summary row); a paused assignment keeps its share learned (R-222) and its
 * loader gives it nothing to train (R-46).
 */
function rowParts(
  training: RepertoireTraining | undefined,
  state: SummaryState,
): RowParts {
  if (state.mode === 'build' || state.graph.chapters.length === 0)
    return { standing: undefined, links: undefined };
  const standing = training?.standing;
  const trainable = training?.trainable ?? undefined;
  return {
    standing: hasProgress(standing) ? standing : undefined,
    links: hasTrainLinks(trainable) ? trainable : undefined,
  };
}

/**
 * The summary row, first in the panel (spec, Summary row): the share
 * learned, then Review and Learn for a player who trains it, on one
 * wrapping row; on an assignment, the status strip as a second line. Side
 * and chapters are not repeated: the board and "Ch 1/6" say them. Nothing
 * when there is nothing to say, so the panel has no empty gap.
 */
export function SummaryLine({
  training,
  assignment,
  state,
}: {
  /** The viewer's training as its page loaded; absent where they do not train it. */
  readonly training?: RepertoireTraining | undefined;
  readonly assignment?: SummaryAssignment | undefined;
  /** The view's mode and graph: the builder and an empty repertoire have no row. */
  readonly state: SummaryState;
}): JSX.Element | null {
  const { standing: shown, links } = rowParts(training, state);
  const row = shown !== undefined || links !== undefined;
  if (!row && assignment === undefined) return null;
  return (
    <div className="flex flex-col gap-1">
      {row ? <SummaryRow standing={shown} links={links} /> : null}
      {assignment === undefined ? null : (
        <StatusStrip assignment={assignment} />
      )}
    </div>
  );
}
