import type { ProgressCounts } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { standingHeadline, STATUS_FLAGS } from './standing-headline';

const LIVE = { overdue: false, paused: false, done: false };
const EMPTY: ProgressCounts = { learned: 0, due: 0, skipped: 0, notStarted: 0 };
const UNSTARTED: ProgressCounts = {
  learned: 0,
  due: 0,
  skipped: 0,
  notStarted: 12,
};
const UNDER_WAY: ProgressCounts = {
  learned: 4,
  due: 3,
  skipped: 1,
  notStarted: 2,
};

describe('standingHeadline: which word a coach row leads with (R-231, #381 sign-off)', () => {
  it('says the status flags in the order Overdue, Paused, Done', () => {
    expect(STATUS_FLAGS).toEqual(['overdue', 'paused', 'done']);
  });

  it('leads with the first status flag on, over everything else', () => {
    expect(
      standingHeadline(EMPTY, { overdue: true, paused: true, done: true }),
    ).toEqual({ kind: 'status', flag: 'overdue' });
    expect(
      standingHeadline(UNSTARTED, { ...LIVE, paused: true, done: true }),
    ).toEqual({ kind: 'status', flag: 'paused' });
    expect(standingHeadline(UNDER_WAY, { ...LIVE, done: true })).toEqual({
      kind: 'status',
      flag: 'done',
    });
  });

  it('says nothing to learn for an empty repertoire with no flag on', () => {
    expect(standingHeadline(EMPTY, LIVE)).toEqual({ kind: 'nothing' });
  });

  it('says not started, with the moves, when nothing is started', () => {
    expect(standingHeadline(UNSTARTED, LIVE)).toEqual({
      kind: 'notStarted',
      moves: 12,
    });
  });

  it('says the share learned with the counts once something is started', () => {
    expect(standingHeadline(UNDER_WAY, LIVE)).toEqual({
      kind: 'counts',
      percent: 40,
      counts: UNDER_WAY,
    });
  });

  it('rounds the share learned', () => {
    const counts = { learned: 1, due: 2, skipped: 0, notStarted: 0 };
    expect(standingHeadline(counts, LIVE)).toEqual({
      kind: 'counts',
      percent: 33,
      counts,
    });
  });

  it('reads the counts alone where the row says no status', () => {
    expect(standingHeadline(EMPTY, null)).toEqual({ kind: 'nothing' });
    expect(standingHeadline(UNSTARTED, null)).toEqual({
      kind: 'notStarted',
      moves: 12,
    });
    expect(standingHeadline(UNDER_WAY, null).kind).toBe('counts');
  });
});
