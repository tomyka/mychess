/**
 * What the coach dashboard says of one player (R-229, R-231): the most
 * urgent reason they need attention, or none, and their summary line.
 * Pure: the reads give each row's status and counts (R-151, R-155). Days
 * count in Europe/Vilnius, as overdue does.
 */
import { percentLearned, type ProgressCounts } from '@mychess/chess';
import type { AssignmentStatus } from './assignment';
import { daysBetween, vilniusDay } from './calendar';
import { byNameAndId, type NameAndId } from './name-order';

/** A deadline this many Vilnius days away or fewer is near. */
export const NEAR_DEADLINE_DAYS = 3;
/** Under this share learned, a near deadline needs attention. */
export const NEAR_DEADLINE_PERCENT = 80;
/** This many due moves or more is a pile-up. */
export const DUE_PILE = 30;
/** This many Vilnius days without training is idle. */
export const IDLE_DAYS = 7;

/** An assignment's status with its effective deadline (`YYYY-MM-DD`). */
export type CoachRowStatus = AssignmentStatus & {
  readonly deadline: string | null;
};

/** One repertoire the coach may see: an assignment (status) or a share (null). */
export interface CoachRowFacts {
  readonly name: string;
  readonly status: CoachRowStatus | null;
  /** Its counts where granted; null for a forked assignment (R-155). */
  readonly counts: ProgressCounts | null;
}

export interface AttentionInput {
  readonly rows: readonly CoachRowFacts[];
  /** The last training on what the coach may see (R-154), or never. */
  readonly lastTrained: Date | null;
  /** When the coach and the player were linked: idle counts from here. */
  readonly linkedAt: Date;
}

export type Attention =
  | {
      readonly kind: 'overdue';
      readonly repertoires: readonly string[];
      readonly days: number;
    }
  | {
      readonly kind: 'deadlineNear';
      readonly repertoire: string;
      readonly days: number;
      readonly percent: number;
    }
  | { readonly kind: 'duePile'; readonly due: number }
  | { readonly kind: 'idle'; readonly days: number };

/** A live (not forked) assignment's row. */
interface LiveRow extends CoachRowFacts {
  readonly status: CoachRowStatus;
}

/** One repertoire's distance to its deadline, for the near and overdue reasons. */
interface DatedRow {
  readonly name: string;
  readonly days: number;
}

/** Whole Vilnius days from today to `day` (`YYYY-MM-DD`), negative when past. */
const daysUntil = (day: string, now: Date): number =>
  daysBetween(now, new Date(`${day}T12:00:00Z`));

/** A `YYYY-MM-DD` day at noon UTC: the same calendar day in Vilnius. */
const noonOf = (day: string): Date => new Date(`${day}T12:00:00Z`);

/**
 * Whole Vilnius days from `today` to `deadline` (both `YYYY-MM-DD`),
 * negative when past, and whether that is near: from today up to
 * NEAR_DEADLINE_DAYS ahead. A passed deadline is never near (R-229, R-231).
 */
export function deadlineNearness(
  deadline: string,
  today: string,
): { readonly days: number; readonly near: boolean } {
  const days = daysBetween(noonOf(today), noonOf(deadline));
  return { days, near: days >= 0 && days <= NEAR_DEADLINE_DAYS };
}

const live = (rows: readonly CoachRowFacts[]): LiveRow[] =>
  rows.flatMap((row) =>
    row.status !== null && !row.status.forked
      ? [{ ...row, status: row.status }]
      : [],
  );

/** Rows whose counts may be summed: shares and live assignments (R-155). */
const visible = (rows: readonly CoachRowFacts[]): CoachRowFacts[] =>
  rows.filter((row) => !row.status?.forked);

function overdueRow(row: LiveRow, now: Date): DatedRow[] {
  const { overdue, deadline } = row.status;
  return overdue && deadline !== null
    ? [{ name: row.name, days: -daysUntil(deadline, now) }]
    : [];
}

function overdue(rows: readonly CoachRowFacts[], now: Date): Attention | null {
  const late = live(rows).flatMap((row) => overdueRow(row, now));
  if (late.length === 0) return null;
  return {
    kind: 'overdue',
    repertoires: late.map((row) => row.name),
    days: Math.max(...late.map((row) => row.days)),
  };
}

function nearRow(
  row: LiveRow,
  now: Date,
): (DatedRow & { readonly percent: number })[] {
  const { done, deadline } = row.status;
  if (done || deadline === null || row.counts === null) return [];
  const percent = percentLearned(row.counts);
  const { days, near } = deadlineNearness(deadline, vilniusDay(now));
  return percent !== null && near && percent < NEAR_DEADLINE_PERCENT
    ? [{ name: row.name, days, percent }]
    : [];
}

function deadlineNear(
  rows: readonly CoachRowFacts[],
  now: Date,
): Attention | null {
  const [nearest] = live(rows)
    .flatMap((row) => nearRow(row, now))
    .toSorted((a, b) => a.days - b.days);
  return nearest === undefined
    ? null
    : {
        kind: 'deadlineNear',
        repertoire: nearest.name,
        days: nearest.days,
        percent: nearest.percent,
      };
}

function duePile(rows: readonly CoachRowFacts[]): Attention | null {
  const due = visible(rows).reduce(
    (sum, row) => sum + (row.counts?.due ?? 0),
    0,
  );
  return due >= DUE_PILE ? { kind: 'duePile', due } : null;
}

function idle(input: AttentionInput, now: Date): Attention | null {
  const unfinished = live(input.rows).some(
    (row) => !row.status.done && !row.status.paused,
  );
  if (!unfinished) return null;
  const days = daysBetween(input.lastTrained ?? input.linkedAt, now);
  return days >= IDLE_DAYS ? { kind: 'idle', days } : null;
}

/** The most urgent reason the player needs attention (R-229), or null. */
export function attentionOf(
  input: AttentionInput,
  now: Date,
): Attention | null {
  return (
    overdue(input.rows, now) ??
    deadlineNear(input.rows, now) ??
    duePile(input.rows) ??
    idle(input, now)
  );
}

/** The reasons, most urgent first (R-229). */
export const ATTENTION_ORDER = [
  'overdue',
  'deadlineNear',
  'duePile',
  'idle',
] as const satisfies readonly Attention['kind'][];

const rank = (reason: Attention): number =>
  ATTENTION_ORDER.indexOf(reason.kind);

/**
 * The order of the Needs attention cards (R-229): most urgent reason first,
 * then by name in the one name order (R-160).
 */
export const byAttention = (
  a: NameAndId & { readonly reason: Attention },
  b: NameAndId & { readonly reason: Attention },
): number => rank(a.reason) - rank(b.reason) || byNameAndId(a, b);

/** A player's line on the dashboard (R-231). */
export interface PlayerSummary {
  /** Summed over every row with counts; null when none has any. */
  readonly counts: ProgressCounts | null;
  /** The earliest deadline of a live assignment not done. */
  readonly nextDeadline: string | null;
  /** There is a live assignment and every one is done. */
  readonly allDone: boolean;
  /** Some live assignment is overdue; a forked one never is (R-155). */
  readonly overdue: boolean;
}

const add = (a: ProgressCounts, b: ProgressCounts): ProgressCounts => ({
  notStarted: a.notStarted + b.notStarted,
  skipped: a.skipped + b.skipped,
  due: a.due + b.due,
  learned: a.learned + b.learned,
});

const openDeadline = (row: LiveRow): string[] =>
  row.status.done || row.status.deadline === null ? [] : [row.status.deadline];

export function playerSummary(rows: readonly CoachRowFacts[]): PlayerSummary {
  const [first, ...rest] = visible(rows).flatMap((row) =>
    row.counts === null ? [] : [row.counts],
  );
  const assignments = live(rows);
  const [nextDeadline] = assignments.flatMap(openDeadline).toSorted();
  return {
    counts: first === undefined ? null : rest.reduce(add, first),
    nextDeadline: nextDeadline ?? null,
    allDone:
      assignments.length > 0 && assignments.every((row) => row.status.done),
    overdue: assignments.some((row) => row.status.overdue),
  };
}
