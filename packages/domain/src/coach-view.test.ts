import {
  importPgn,
  playerKeys,
  startReview,
  type RepertoireGraph,
  type TrackedReview,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import type { ProgressRepertoire } from './coach-progress';
import { coachViewOf, coachViewTag, type CoachView } from './coach-view';

function graphOf(pgn: string): RepertoireGraph {
  const imported = importPgn(pgn, 'white');
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

/** A white repertoire: the player moves are 1. e4 and 2. Nf3. */
const GRAPH = graphOf('1. e4 e5 2. Nf3 Nc6 *');
const NOW = new Date('2026-11-27T10:00:00Z');
const REVIEWED = { graph: GRAPH, tracked: new Map(), now: NOW };
const ITALIAN = { id: 'italian', name: 'Italian', side: 'white' } as const;

const assignment = (forkedAt: Date | null): AssignmentFacts => ({
  playerId: 'p',
  repertoireId: 'italian',
  coachId: 'c',
  reaches: [
    {
      assignmentId: 'a',
      deadline: '2026-11-20',
      assignedVersion: 1,
      joinedAt: null,
    },
  ],
  pausedAt: null,
  seenVersion: null,
  forkedAt,
});

const STANDING = {
  counts: { notStarted: 2, skipped: 0, due: 0, learned: 0 },
  mastered: false,
};

describe('coachViewOf (the Coach view, R-155)', () => {
  it('gives a live assignment its status and standing', () => {
    const entry: ProgressRepertoire = {
      repertoireId: 'italian',
      kind: 'granted',
      source: 'assigned',
      assignment: assignment(null),
    };
    expect(coachViewOf(entry, ITALIAN, REVIEWED)).toStrictEqual({
      repertoire: ITALIAN,
      source: 'assigned',
      forkOf: null,
      status: {
        deadline: '2026-11-20',
        overdue: true,
        paused: false,
        done: false,
        forked: false,
      },
      view: { kind: 'granted', standing: STANDING },
    });
  });

  it('gives a forked assignment its status and shared fork, never a standing', () => {
    const entry: ProgressRepertoire = {
      repertoireId: 'italian',
      kind: 'forked',
      source: 'assigned',
      assignment: assignment(new Date('2026-11-01T10:00:00Z')),
      sharedForkId: 'fork',
    };
    expect(coachViewOf(entry, ITALIAN, REVIEWED)).toStrictEqual({
      repertoire: ITALIAN,
      source: 'assigned',
      forkOf: null,
      status: {
        deadline: '2026-11-20',
        overdue: false,
        paused: false,
        done: false,
        forked: true,
      },
      view: { kind: 'forked', sharedForkId: 'fork' },
    });
  });

  it('gives a shared one its standing, no status, and the repertoire it is a Fork of', () => {
    const entry: ProgressRepertoire = {
      repertoireId: 'fork',
      kind: 'granted',
      source: 'shared',
      assignment: null,
      forkOf: 'italian',
    };
    const fork = { ...ITALIAN, id: 'fork' };
    expect(coachViewOf(entry, fork, REVIEWED)).toStrictEqual({
      repertoire: fork,
      source: 'shared',
      forkOf: 'italian',
      status: null,
      view: { kind: 'granted', standing: STANDING },
    });
  });

  it('counts the player’s Reviews in the standing and the status', () => {
    const entry: ProgressRepertoire = {
      repertoireId: 'italian',
      kind: 'granted',
      source: 'assigned',
      assignment: assignment(null),
    };
    // "I know this" on both player moves, today: skipped, and tracked.
    const tracked = new Map(
      playerKeys(GRAPH).map((key): [string, TrackedReview] => [
        key,
        { review: startReview(key, NOW), knownWithoutLearning: true },
      ]),
    );
    const view = coachViewOf(entry, ITALIAN, { ...REVIEWED, tracked });
    expect(view.status?.done).toBe(true);
    expect(view.view).toStrictEqual({
      kind: 'granted',
      standing: {
        counts: { notStarted: 0, skipped: 2, due: 0, learned: 0 },
        mastered: false,
      },
    });
  });
});

describe('coachViewTag (one rule for the player and progress pages)', () => {
  const GRANTED = { kind: 'granted', standing: STANDING } as const;
  const view = (over: Partial<CoachView>): CoachView => ({
    repertoire: ITALIAN,
    source: 'assigned',
    forkOf: null,
    status: null,
    view: GRANTED,
    ...over,
  });

  it('tags a live assignment assigned and a share shared', () => {
    expect(coachViewTag(view({}))).toBe('assigned');
    expect(coachViewTag(view({ source: 'shared' }))).toBe('shared');
  });

  it('tags a forked assignment a fork, shared or not (R-155)', () => {
    expect(
      coachViewTag(view({ view: { kind: 'forked', sharedForkId: null } })),
    ).toBe('fork');
    expect(
      coachViewTag(view({ view: { kind: 'forked', sharedForkId: 'f' } })),
    ).toBe('fork');
  });

  it('tags a share that is the player’s Fork of the coach’s repertoire a fork (#328)', () => {
    expect(coachViewTag(view({ source: 'shared', forkOf: 'italian' }))).toBe(
      'fork',
    );
  });
});
