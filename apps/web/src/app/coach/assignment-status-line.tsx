import type { CoachStatus } from '@mychess/db';
import { deadlineNearness } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { Pill, type PillTone } from '../pill';
import { useShortDeadline } from '../use-deadline';

/** "Due …" in a list; "deadline …" where "due" would read as training. */
type Wording = 'due' | 'deadline';

/** The pills in the order they show, with their tones. */
const PILLS = [
  ['overdue', 'overdue'],
  ['paused', 'neutral'],
  ['done', 'done'],
] as const satisfies readonly (readonly [string, PillTone])[];

/** What the deadline text says, and whether to draw it in the due tone. */
interface DeadlineText {
  readonly text: string;
  readonly near: boolean;
}

/**
 * The deadline in words: none when done or overdue without one. Otherwise
 * the date, in "deadline" wording alone, in "due" wording with the days to
 * it ("Due today" on the day), the date alone once done or overdue (the
 * Overdue pill follows it). The domain decides what is near; done and
 * overdue are never near.
 */
function useDeadlineText(
  status: CoachStatus,
  today: string,
  wording: Wording,
): DeadlineText | null {
  const t = useTranslations('coach.status');
  const date = useShortDeadline(today);
  const { deadline, overdue, done } = status;
  if (deadline === null)
    return done || overdue ? null : { text: t('noDeadline'), near: false };
  const on = date(deadline);
  const { days, near } = deadlineNearness(deadline, today);
  const tone = near && !done && !overdue;
  if (wording === 'deadline')
    return { text: t('deadline', { date: on }), near: tone };
  if (done || overdue) return { text: t('dueOn', { date: on }), near: false };
  return days === 0
    ? { text: t('dueToday'), near: tone }
    : { text: t('due', { date: on, days }), near: tone };
}

/**
 * An assignment's status in the same words everywhere (spec, Shared
 * pieces): "Due Nov 30 · in 3 days" (amber when near and not done), "Due
 * today", "No deadline", then the Overdue, Paused and Done pills. An own
 * copy shows nothing: it has no deadline or done (R-155), and its card says
 * "own copy" itself. `today` is the page's Vilnius day from the loader, so
 * the server and the browser agree.
 */
export function AssignmentStatusLine({
  status,
  today,
  wording,
}: {
  readonly status: CoachStatus;
  readonly today: string;
  readonly wording: Wording;
}): JSX.Element | null {
  const badge = useTranslations('assignment.badge');
  const t = useTranslations('coach.status');
  const text = useDeadlineText(status, today, wording);
  if (status.forked) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {text === null ? null : (
        <span className={text.near ? 'text-due' : 'text-fg-muted'}>
          {text.text}
        </span>
      )}
      {PILLS.filter(([flag]) => status[flag]).map(([flag, tone]) => (
        <Pill key={flag} tone={tone}>
          {flag === 'done' ? t('done') : badge(flag)}
        </Pill>
      ))}
    </p>
  );
}
