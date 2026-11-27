import { describe, expect, it } from 'vitest';
import { playerPageCards } from './coach-player-page';
import type { CoachRowStatus, CoachView } from './coach-view';

const status = (s: Partial<CoachRowStatus>): CoachRowStatus => ({
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  forked: false,
  ...s,
});
const STANDING = {
  counts: { notStarted: 1, skipped: 2, due: 3, learned: 4 },
  mastered: false,
};
const GRANTED = { kind: 'granted', standing: STANDING } as const;
const repertoire = (name: string, id = name) =>
  ({ id, name, side: 'white' }) as const;

/** A live assignment's view, or a forked one's when its status says so. */
const assigned = (
  name: string,
  s: Partial<CoachRowStatus>,
  id = name,
): CoachView => ({
  repertoire: repertoire(name, id),
  source: 'assigned',
  forkOf: null,
  status: status(s),
  view: s.forked === true ? { kind: 'forked', sharedForkId: null } : GRANTED,
});
const shared = (name: string, id = name, forkOf: string | null = null) =>
  ({
    repertoire: repertoire(name, id),
    source: 'shared',
    forkOf,
    status: null,
    view: GRANTED,
  }) as const satisfies CoachView;
const forked = (name: string, sharedForkId: string | null): CoachView => ({
  repertoire: repertoire(name),
  source: 'assigned',
  forkOf: null,
  status: status({ forked: true }),
  view: { kind: 'forked', sharedForkId },
});

const order = (views: readonly CoachView[]): string[] =>
  playerPageCards(views).map((card) => card.repertoire.id);

describe('playerPageCards: the order (the player page, R-160)', () => {
  it('puts overdue first, then the soonest deadline, then those without one, then shares', () => {
    expect(
      order([
        shared('Taimanov'),
        assigned('Caro-Kann', {}),
        assigned('Slav', { deadline: '2026-12-20' }),
        assigned('Italian', { deadline: '2026-11-20', overdue: true }),
        assigned('Najdorf', { deadline: '2026-12-01' }),
      ]),
    ).toEqual(['Italian', 'Najdorf', 'Slav', 'Caro-Kann', 'Taimanov']);
  });

  it('keeps a paused overdue one overdue (R-132)', () => {
    expect(
      order([
        assigned('Najdorf', { deadline: '2026-11-28' }),
        assigned('Italian', {
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
        shared('Taimanov'),
        assigned('Benoni', {}),
        assigned('Slav', { deadline: '2026-11-10', done: true }),
        assigned('Najdorf', { deadline: '2026-12-28' }),
        assigned('Alapin', { deadline: '2026-11-05', done: true }),
      ]),
    ).toEqual(['Najdorf', 'Alapin', 'Slav', 'Benoni', 'Taimanov']);
  });

  it('orders overdue ones by the longest overdue first', () => {
    expect(
      order([
        assigned('Alapin', { deadline: '2026-11-25', overdue: true }),
        assigned('Zukertort', { deadline: '2026-11-01', overdue: true }),
      ]),
    ).toEqual(['Zukertort', 'Alapin']);
  });

  it('sorts a forked assignment as without a deadline, before the shares (R-155)', () => {
    expect(
      order([
        shared('Taimanov'),
        assigned('Italian', { deadline: '2026-11-01', forked: true }),
        assigned('Slav', { deadline: '2026-12-20' }),
        assigned('Benoni', {}),
      ]),
    ).toEqual(['Slav', 'Benoni', 'Italian', 'Taimanov']);
  });

  it('breaks ties by name, then by id', () => {
    expect(
      order([
        shared('Slav', 'b'),
        shared('Benoni'),
        shared('Slav', 'a'),
        assigned('Italian', { deadline: '2026-12-01' }),
        assigned('Caro-Kann', { deadline: '2026-12-01' }),
      ]),
    ).toEqual(['Caro-Kann', 'Italian', 'Benoni', 'a', 'b']);
  });
});

describe('playerPageCards: one card per repertoire (R-155, #328)', () => {
  it('tags each card and gives it the standing granted on it', () => {
    expect(playerPageCards([assigned('Slav', {}), shared('Taimanov')])).toEqual(
      [
        {
          repertoire: repertoire('Slav'),
          tag: 'assigned',
          status: status({}),
          granted: { id: 'Slav', standing: STANDING },
        },
        {
          repertoire: repertoire('Taimanov'),
          tag: 'shared',
          status: null,
          granted: { id: 'Taimanov', standing: STANDING },
        },
      ],
    );
  });

  it('makes a forked assignment and the fork the player shares one fork card with the fork’s standing', () => {
    const cards = playerPageCards([
      assigned('Slav', { deadline: '2026-12-20' }),
      forked('Italian', 'fork'),
      shared('Italian', 'fork', 'Italian'),
      shared('Taimanov'),
    ]);
    expect(cards).toEqual([
      {
        repertoire: repertoire('Slav'),
        tag: 'assigned',
        status: status({ deadline: '2026-12-20' }),
        granted: { id: 'Slav', standing: STANDING },
      },
      {
        repertoire: repertoire('Italian'),
        tag: 'fork',
        status: status({ forked: true }),
        granted: { id: 'fork', standing: STANDING },
      },
      {
        repertoire: repertoire('Taimanov'),
        tag: 'shared',
        status: null,
        granted: { id: 'Taimanov', standing: STANDING },
      },
    ]);
  });

  it('keeps a fork the player does not share without progress', () => {
    expect(playerPageCards([forked('Italian', null)])).toEqual([
      {
        repertoire: repertoire('Italian'),
        tag: 'fork',
        status: status({ forked: true }),
        granted: null,
      },
    ]);
  });

  it('takes the fork only from what is shared with the coach', () => {
    expect(
      playerPageCards([
        assigned('Slav', { deadline: '2026-12-20' }),
        forked('Italian', 'Slav'),
      ]).map(({ repertoire: { id }, granted }) => [id, granted?.id ?? null]),
    ).toEqual([
      ['Slav', 'Slav'],
      ['Italian', null],
    ]);
  });

  it('tags a shared Fork with no forked assignment on the page a fork, as its progress page does (#328)', () => {
    expect(playerPageCards([shared('Italian', 'fork', 'italian')])).toEqual([
      {
        repertoire: repertoire('Italian', 'fork'),
        tag: 'fork',
        status: null,
        granted: { id: 'fork', standing: STANDING },
      },
    ]);
  });
});
