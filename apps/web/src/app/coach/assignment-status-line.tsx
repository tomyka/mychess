import type { CoachStatus } from '@mychess/db';
import { deadlineNearness } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';
import type { LiveStatus } from '../../server/live-status';
import { Pill, type PillTone } from '../pill';
import { useShortDeadline } from '../use-deadline';
import {
  STATUS_FLAGS,
  type StatusFlag,
  type StatusFlags,
} from './standing-headline';

/**
 * "Due …" with the days to it in a list; "deadline …" where "due" would
 * read as training; "due …" alone before other parts, as a group's
 * assignment before its done count.
 */
type Wording = 'due' | 'deadline' | 'dueShort';

/**
 * What of a row's status the line shows: a live assignment's facts, or
 * null for a row with no status (a share) or a fork, which has no deadline
 * or done of its own (R-155).
 */
export function liveStatus(status: CoachStatus | null): LiveStatus | null {
  if (status === null || status.forked) return null;
  const { deadline, overdue, paused, done } = status;
  return { deadline, overdue, paused, done };
}

/** Each status pill's tone. */
const TONES = {
  overdue: 'overdue',
  paused: 'neutral',
  done: 'done',
} as const satisfies Record<StatusFlag, PillTone>;

/** What the deadline text says, and whether to draw it in the due tone. */
interface DeadlineText {
  readonly text: string;
  readonly near: boolean;
}

/**
 * The deadline in words: none when done or overdue without one. Otherwise
 * the date, in "deadline" or short "due" wording alone, in "due" wording
 * with the days to it ("Due today" on the day), the date alone once done
 * or overdue (the Overdue pill follows it). The domain decides what is
 * near; done and overdue are never near.
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
  if (wording !== 'due') return { text: t(wording, { date: on }), near: tone };
  if (done || overdue) return { text: t('dueOn', { date: on }), near: false };
  return days === 0
    ? { text: t('dueToday'), near: tone }
    : { text: t('due', { date: on, days }), near: tone };
}

/** A status pill: its word and its tone. */
export interface StatusPill {
  readonly word: string;
  readonly tone: PillTone;
}

/** A status flag's pill, its word and its tone: the same everywhere. */
export function useStatusPill(): (flag: StatusFlag) => StatusPill {
  const badge = useTranslations('assignment.badge');
  const t = useTranslations('coach.status');
  return (flag) => ({
    word: flag === 'done' ? t('done') : badge(flag),
    tone: TONES[flag],
  });
}

/**
 * The pills an assignment's status has on, in the order they show
 * (Overdue, Paused, Done).
 */
export function useStatusPills(): (status: StatusFlags) => StatusPill[] {
  const pill = useStatusPill();
  return (status) => STATUS_FLAGS.filter((flag) => status[flag]).map(pill);
}

/** The Overdue, Paused and Done pills an assignment's status has on. */
function StatusPills({
  status,
}: {
  readonly status: StatusFlags;
}): JSX.Element {
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
 * today", "No deadline", then the Overdue, Paused and Done pills. Only a
 * live assignment has one: an own copy has no deadline or done (R-155), so
 * its callers leave it out and its card says "own copy" itself. `today` is
 * the page's Vilnius day from the loader, so the server and the browser
 * agree. With `parts="pills"` it leaves the deadline to a row that says it
 * already (a group's member under the group's row), and is nothing with no
 * pill on.
 */
export function AssignmentStatusLine({
  status,
  today,
  wording,
  parts = 'all',
}: {
  readonly status: LiveStatus;
  readonly today: string;
  readonly wording: Exclude<Wording, 'dueShort'>;
  readonly parts?: 'all' | 'pills';
}): JSX.Element | null {
  const deadline = useDeadlineText(status, today, wording);
  const pills = useStatusPills()(status);
  const text = parts === 'all' ? deadline : null;
  if (text === null && pills.length === 0) return null;
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
 * Nov 30" (in the due tone when near), or "No deadline", then whatever
 * follows it on the line (`children`). A group's assignment has no overdue
 * or done of its own: those are each member's.
 */
export function DeadlineLine({
  deadline,
  today,
  wording = 'deadline',
  children,
}: {
  readonly deadline: string | null;
  readonly today: string;
  readonly wording?: Exclude<Wording, 'due'>;
  readonly children?: ReactNode;
}): JSX.Element {
  const text = useDeadlineText(
    { deadline, overdue: false, done: false },
    today,
    wording,
  );
  return (
    <p className="text-sm">
      {text === null ? null : <DeadlineSpan text={text} />}
      {children}
    </p>
  );
}
