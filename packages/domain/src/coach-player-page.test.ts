import { describe, expect, it } from 'vitest';
import type { CoachRowStatus } from './coach-attention';
import {
  byRepertoireUrgency,
  ownCopyEntries,
  type OwnCopyFacts,
  type RepertoireUrgencyKey,
} from './coach-player-page';

const status = (s: Partial<CoachRowStatus>): CoachRowStatus => ({
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  forked: false,
  ...s,
});

describe('byRepertoireUrgency (the player page, R-160)', () => {
  const card = (
    name: string,
    s: Partial<CoachRowStatus> | null,
    id = name,
  ): RepertoireUrgencyKey => ({
    name,
    id,
    status: s === null ? null : status(s),
  });
  const order = (cards: readonly RepertoireUrgencyKey[]): string[] =>
    cards.toSorted(byRepertoireUrgency((one) => one)).map((one) => one.id);

  it('puts overdue first, then the soonest deadline, then those without one, then shares', () => {
    expect(
      order([
        card('Taimanov', null),
        card('Caro-Kann', {}),
        card('Slav', { deadline: '2026-12-20' }),
        card('Italian', { deadline: '2026-11-20', overdue: true }),
        card('Najdorf', { deadline: '2026-12-01' }),
      ]),
    ).toEqual(['Italian', 'Najdorf', 'Slav', 'Caro-Kann', 'Taimanov']);
  });

  it('keeps a paused overdue one overdue (R-132)', () => {
    expect(
      order([
        card('Najdorf', { deadline: '2026-11-28' }),
        card('Italian', {
          deadline: '2026-11-20',
          overdue: true,
          paused: true,
        }),
      ]),
    ).toEqual(['Italian', 'Najdorf']);
  });

  it('puts done ones after the unfinished dated ones, by deadline, and before the undated (R-129)', () => {
    expect(
      order([
        card('Taimanov', null),
        card('Benoni', {}),
        card('Slav', { deadline: '2026-11-10', done: true }),
        card('Najdorf', { deadline: '2026-12-28' }),
        card('Alapin', { deadline: '2026-11-05', done: true }),
      ]),
    ).toEqual(['Najdorf', 'Alapin', 'Slav', 'Benoni', 'Taimanov']);
  });

  it('orders overdue ones by the longest overdue first', () => {
    expect(
      order([
        card('Alapin', { deadline: '2026-11-25', overdue: true }),
        card('Zukertort', { deadline: '2026-11-01', overdue: true }),
      ]),
    ).toEqual(['Zukertort', 'Alapin']);
  });

  it('sorts an own copy as without a deadline, before the shares (R-155)', () => {
    expect(
      order([
        card('Taimanov', null),
        card('Italian', { deadline: '2026-11-01', forked: true }),
        card('Slav', { deadline: '2026-12-20' }),
        card('Benoni', {}),
      ]),
    ).toEqual(['Slav', 'Benoni', 'Italian', 'Taimanov']);
  });

  it('breaks ties by name, then by id', () => {
    expect(
      order([
        card('Slav', null, 'b'),
        card('Benoni', null),
        card('Slav', null, 'a'),
        card('Italian', { deadline: '2026-12-01' }),
        card('Caro-Kann', { deadline: '2026-12-01' }),
      ]),
    ).toEqual(['Caro-Kann', 'Italian', 'Benoni', 'a', 'b']);
  });
});

describe('ownCopyEntries (R-155, the player page)', () => {
  const assignment = (id: string): OwnCopyFacts => ({
    id,
    shared: false,
    forked: null,
  });
  const share = (id: string): OwnCopyFacts => ({
    id,
    shared: true,
    forked: null,
  });
  const forked = (id: string, sharedForkId: string | null): OwnCopyFacts => ({
    id,
    shared: false,
    forked: { sharedForkId },
  });
  const entries = (rows: readonly OwnCopyFacts[]) =>
    ownCopyEntries(rows, (row) => row);

  it('makes a forked assignment and the fork the player shares one own copy', () => {
    const italian = forked('italian', 'fork');
    const fork = share('fork');
    expect(
      entries([assignment('slav'), italian, fork, share('taimanov')]),
    ).toEqual([
      { kind: 'row', row: assignment('slav') },
      { kind: 'ownCopy', assignment: italian, sharedFork: fork },
      { kind: 'row', row: share('taimanov') },
    ]);
  });

  it('keeps an own copy the player does not share without a fork', () => {
    const italian = forked('italian', null);
    expect(entries([italian, share('taimanov')])).toEqual([
      { kind: 'ownCopy', assignment: italian, sharedFork: null },
      { kind: 'row', row: share('taimanov') },
    ]);
  });

  it('takes the fork only from what is shared with the coach', () => {
    const italian = forked('italian', 'slav');
    expect(entries([assignment('slav'), italian])).toEqual([
      { kind: 'row', row: assignment('slav') },
      { kind: 'ownCopy', assignment: italian, sharedFork: null },
    ]);
  });
});
