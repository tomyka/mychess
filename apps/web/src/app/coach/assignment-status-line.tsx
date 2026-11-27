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
  status: Pick<CoachStatus, 'deadline' | 'overdue' | 'done'>,
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

/** The status flags a pill says. */
type PillFlags = Pick<CoachStatus, 'overdue' | 'paused' | 'done'>;

/** A status pill: its word and its tone. */
export interface StatusPill {
  readonly word: string;
  readonly tone: PillTone;
}

/**
 * The pills an assignment's status has on, in the order they show
 * (Overdue, Paused, Done), with their words: the same everywhere.
 */
export function useStatusPills(): (status: PillFlags) => StatusPill[] {
  const badge = useTranslations('assignment.badge');
  const t = useTranslations('coach.status');
  return (status) =>
    PILLS.filter(([flag]) => status[flag]).map(([flag, tone]) => ({
      word: flag === 'done' ? t('done') : badge(flag),
      tone,
    }));
}

/** The Overdue, Paused and Done pills an assignment's status has on. */
function StatusPills({ status }: { readonly status: PillFlags }): JSX.Element {
  const pills = useStatusPills();
  return (
    <>
      {pills(status).map(({ word, tone }) => (
        <Pill key={word} tone={tone}>
          {word}
        </Pill>
      ))}
    </>
  );
}

/**
 * An assignment's status in the same words everywhere (spec, Shared
 * pieces): "Due Nov 30 · in 3 days" (amber when near and not done), "Due
 * today", "No deadline", then the Overdue, Paused and Done pills. An own
 * copy shows nothing: it has no deadline or done (R-155), and its card says
 * "own copy" itself. `today` is the page's Vilnius day from the loader, so
 * the server and the browser agree. With `parts="pills"` it leaves the
 * deadline to a row that says it already (a group's member under the
 * group's row), and is nothing with no pill on.
 */
export function AssignmentStatusLine({
  status,
  today,
  wording,
  parts = 'all',
}: {
  readonly status: CoachStatus;
  readonly today: string;
  readonly wording: Wording;
  readonly parts?: 'all' | 'pills';
}): JSX.Element | null {
  const deadline = useDeadlineText(status, today, wording);
  const pills = useStatusPills()(status);
  const text = parts === 'all' ? deadline : null;
  if (status.forked || (text === null && pills.length === 0)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {text === null ? null : <DeadlineSpan text={text} />}
      <StatusPills status={status} />
    </p>
  );
}

/** The deadline's words, in the due tone when near. */
function DeadlineSpan({ text }: { readonly text: DeadlineText }): JSX.Element {
  return (
    <span className={text.near ? 'text-due' : 'text-fg-muted'}>
      {text.text}
    </span>
  );
}

/**
 * A deadline that is no one player's, as a group assignment's: "deadline
 * Nov 30" (in the due tone when near), or "No deadline". A group's row has
 * no overdue or done of its own: those are each member's.
 */
export function DeadlineLine({
  deadline,
  today,
}: {
  readonly deadline: string | null;
  readonly today: string;
}): JSX.Element | null {
  const text = useDeadlineText(
    { deadline, overdue: false, done: false },
    today,
    'deadline',
  );
  return text === null ? null : (
    <p className="text-sm">
      <DeadlineSpan text={text} />
    </p>
  );
}
