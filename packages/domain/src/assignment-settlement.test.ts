import { describe, expect, it } from 'vitest';
import type { AssignmentFacts, AssignmentReach } from './assignment';
import {
  settleAssignmentChange,
  type PlayerRepertoire,
  type Settlement,
  type SettlementFacts,
} from './assignment-settlement';

const FORKED_AT = new Date('2026-10-20T10:00:00Z');

const individualReach: AssignmentReach = {
  assignmentId: 'a-1',
  deadline: null,
  assignedVersion: 1,
  joinedAt: null,
};

interface FactsInput {
  readonly player: string;
  readonly repertoire: string;
  readonly coach?: string;
  readonly forkedAt?: Date | null;
  readonly reaches?: readonly AssignmentReach[];
}

const facts = ({
  player,
  repertoire,
  coach = 'c',
  forkedAt = null,
  reaches = [individualReach],
}: FactsInput): AssignmentFacts => ({
  playerId: player,
  repertoireId: repertoire,
  coachId: coach,
  reaches,
  pausedAt: null,
  seenVersion: null,
  forkedAt,
});

const pair = (playerId: string, repertoireId: string): PlayerRepertoire => ({
  playerId,
  repertoireId,
});

const settle = (over: Partial<SettlementFacts>): Settlement =>
  settleAssignmentChange({
    coachId: 'c',
    playerIds: ['p'],
    before: [],
    after: [],
    ...over,
  });

const NOTHING: Settlement = { unfork: [], offer: [], close: [] };

describe('settleAssignmentChange (#289)', () => {
  it('offers the coach’s repertoire a player loses (R-130, R-131)', () => {
    expect(
      settle({ before: [facts({ player: 'p', repertoire: 'r' })] }),
    ).toStrictEqual({ ...NOTHING, offer: [pair('p', 'r')] });
  });

  it('offers nothing to a player who keeps it through another row (R-16)', () => {
    const kept = facts({ player: 'p', repertoire: 'r' });
    expect(settle({ before: [kept], after: [kept] })).toStrictEqual(NOTHING);
  });

  it('offers nothing to a player who forked it (R-128)', () => {
    expect(
      settle({
        before: [facts({ player: 'p', repertoire: 'r', forkedAt: FORKED_AT })],
      }),
    ).toStrictEqual(NOTHING);
  });

  it('closes the offer of a player who regains it', () => {
    expect(
      settle({ after: [facts({ player: 'p', repertoire: 'r' })] }),
    ).toStrictEqual({ ...NOTHING, close: [pair('p', 'r')] });
  });

  it('closes nothing for a player who regains a forked repertoire', () => {
    expect(
      settle({
        after: [facts({ player: 'p', repertoire: 'r', forkedAt: FORKED_AT })],
      }),
    ).toStrictEqual(NOTHING);
  });

  it('leaves another coach’s repertoire, lost or gained, to that coach', () => {
    const lost = facts({ player: 'p', repertoire: 'r1', coach: 'd' });
    const gained = facts({ player: 'p', repertoire: 'r2', coach: 'd' });
    expect(settle({ before: [lost], after: [gained] })).toStrictEqual(NOTHING);
  });

  it('treats a record without reaches as not assigned', () => {
    expect(
      settle({
        before: [facts({ player: 'p', repertoire: 'r1', reaches: [] })],
        after: [facts({ player: 'p', repertoire: 'r2', reaches: [] })],
      }),
    ).toStrictEqual(NOTHING);
    expect(
      settle({
        before: [facts({ player: 'p', repertoire: 'r' })],
        after: [facts({ player: 'p', repertoire: 'r', reaches: [] })],
      }),
    ).toStrictEqual({ ...NOTHING, offer: [pair('p', 'r')] });
  });

  it('settles a player named twice once', () => {
    expect(
      settle({
        playerIds: ['p', 'p'],
        before: [facts({ player: 'p', repertoire: 'r1' })],
        after: [facts({ player: 'p', repertoire: 'r2' })],
      }),
    ).toStrictEqual({
      unfork: [],
      offer: [pair('p', 'r1')],
      close: [pair('p', 'r2')],
    });
  });

  it('settles nothing for no players', () => {
    expect(
      settle({
        playerIds: [],
        before: [facts({ player: 'p', repertoire: 'r1' })],
        after: [facts({ player: 'p', repertoire: 'r2' })],
      }),
    ).toStrictEqual(NOTHING);
  });

  it('ignores a player the change does not name', () => {
    expect(
      settle({
        playerIds: ['q'],
        before: [facts({ player: 'p', repertoire: 'r1' })],
        after: [
          facts({ player: 'p', repertoire: 'r2' }),
          facts({ player: 'p', repertoire: 'r3', forkedAt: FORKED_AT }),
        ],
        given: 'r3',
      }),
    ).toStrictEqual(NOTHING);
  });

  describe('given: assigning again makes a forked repertoire live (R-128)', () => {
    it('unforks the player and closes their offer, offering nothing', () => {
      const forked = facts({
        player: 'p',
        repertoire: 'r',
        forkedAt: FORKED_AT,
      });
      expect(
        settle({ before: [forked], after: [forked], given: 'r' }),
      ).toStrictEqual({
        unfork: [pair('p', 'r')],
        offer: [],
        close: [pair('p', 'r')],
      });
    });

    it('does not unfork another repertoire', () => {
      const forked = facts({
        player: 'p',
        repertoire: 'r2',
        forkedAt: FORKED_AT,
      });
      expect(
        settle({
          before: [forked],
          after: [forked, facts({ player: 'p', repertoire: 'r1' })],
          given: 'r1',
        }),
      ).toStrictEqual({ ...NOTHING, close: [pair('p', 'r1')] });
    });

    it('unforks nothing for a player who had it live', () => {
      const live = facts({ player: 'p', repertoire: 'r' });
      expect(
        settle({ before: [live], after: [live], given: 'r' }),
      ).toStrictEqual(NOTHING);
    });
  });

  it('orders by the players as named, then by repertoire id', () => {
    const lost = (player: string, repertoire: string): AssignmentFacts =>
      facts({ player, repertoire });
    expect(
      settle({
        playerIds: ['q', 'p'],
        before: [
          lost('p', 'r2'),
          lost('p', 'r1'),
          lost('q', 'r2'),
          lost('q', 'r1'),
        ],
      }).offer,
    ).toStrictEqual([
      pair('q', 'r1'),
      pair('q', 'r2'),
      pair('p', 'r1'),
      pair('p', 'r2'),
    ]);
    expect(
      settle({
        playerIds: ['q', 'p'],
        after: [
          lost('p', 'r2'),
          lost('p', 'r1'),
          lost('q', 'r2'),
          lost('q', 'r1'),
        ],
      }).close,
    ).toStrictEqual([
      pair('q', 'r1'),
      pair('q', 'r2'),
      pair('p', 'r1'),
      pair('p', 'r2'),
    ]);
  });
});

/*
 * The properties, checked over every combination in a small universe rather
 * than random samples: two players, the acting coach's repertoire `r1` and
 * another coach's `r2`, each pair absent, live or forked, before and after,
 * for each `given`, with players named in order, out of order, twice or not
 * at all. A record without reaches is covered by the examples above.
 */
describe('settleAssignmentChange over every small case', () => {
  type PairState = 'absent' | 'live' | 'forked';
  const STATES: readonly PairState[] = ['absent', 'live', 'forked'];
  const PAIRS: readonly PlayerRepertoire[] = [
    pair('p', 'r1'),
    pair('p', 'r2'),
    pair('q', 'r1'),
    pair('q', 'r2'),
  ];
  const COACH_OF: Readonly<Record<string, string>> = { r1: 'c', r2: 'd' };
  const PLAYER_IDS: readonly (readonly string[])[] = [['q'], ['q', 'p', 'q']];
  const GIVEN: readonly (string | undefined)[] = [undefined, 'r1', 'r2'];

  const recordOf = (
    at: PlayerRepertoire,
    state: PairState,
  ): AssignmentFacts[] =>
    state === 'absent'
      ? []
      : [
          facts({
            player: at.playerId,
            repertoire: at.repertoireId,
            coach: COACH_OF[at.repertoireId] ?? 'c',
            forkedAt: state === 'forked' ? FORKED_AT : null,
          }),
        ];

  /** The record set numbered `index`: a base-3 digit per pair. */
  const recordsOf = (index: number): AssignmentFacts[] =>
    PAIRS.flatMap((at, position) =>
      recordOf(at, STATES[Math.floor(index / 3 ** position) % 3] ?? 'absent'),
    );

  const SETS = Array.from({ length: 3 ** PAIRS.length }, (_, i) =>
    recordsOf(i),
  );

  const RUNS = SETS.flatMap((before) =>
    SETS.flatMap((after) =>
      PLAYER_IDS.flatMap((playerIds) =>
        GIVEN.map((given) => {
          const scenario: SettlementFacts = {
            coachId: 'c',
            playerIds,
            before,
            after,
            given,
          };
          return { scenario, plan: settleAssignmentChange(scenario) };
        }),
      ),
    ),
  );

  const find = (
    records: readonly AssignmentFacts[],
    at: PlayerRepertoire,
  ): AssignmentFacts | undefined =>
    records.find(
      (r) => r.playerId === at.playerId && r.repertoireId === at.repertoireId,
    );

  /** Live for the acting coach `c`; the given repertoire counts as unforked. */
  const isLive = (
    records: readonly AssignmentFacts[],
    at: PlayerRepertoire,
    given?: string,
  ): boolean => {
    const record = find(records, at);
    return (
      record?.coachId === 'c' &&
      (record.forkedAt === null || record.repertoireId === given)
    );
  };

  const keyOf = (at: PlayerRepertoire): string =>
    `${at.playerId}/${at.repertoireId}`;

  /** The runs whose plan breaks `holds`, for a readable failure. */
  const violations = (
    holds: (run: (typeof RUNS)[number]) => boolean,
  ): unknown[] => RUNS.filter((run) => !holds(run)).slice(0, 3);

  it('covers every case', () => {
    expect(RUNS).toHaveLength(81 * 81 * 2 * 3);
  });

  it('never offers and closes the same pair', () => {
    expect(
      violations(({ plan }) => {
        const closed = new Set(plan.close.map(keyOf));
        return plan.offer.every((at) => !closed.has(keyOf(at)));
      }),
    ).toStrictEqual([]);
  });

  it('offers exactly the coach’s pairs of named players live before and not after', () => {
    expect(
      violations(({ scenario, plan }) => {
        const expected = PAIRS.filter(
          (at) =>
            scenario.playerIds.includes(at.playerId) &&
            isLive(scenario.before, at) &&
            !isLive(scenario.after, at, scenario.given),
        ).map(keyOf);
        return (
          [...plan.offer.map(keyOf)].sort().join() === expected.sort().join()
        );
      }),
    ).toStrictEqual([]);
  });

  it('closes exactly the coach’s pairs of named players live after and not before', () => {
    expect(
      violations(({ scenario, plan }) => {
        const expected = PAIRS.filter(
          (at) =>
            scenario.playerIds.includes(at.playerId) &&
            isLive(scenario.after, at, scenario.given) &&
            !isLive(scenario.before, at),
        ).map(keyOf);
        return (
          [...plan.close.map(keyOf)].sort().join() === expected.sort().join()
        );
      }),
    ).toStrictEqual([]);
  });

  it('unforks exactly the forked pairs of the given repertoire of named players', () => {
    expect(
      violations(({ scenario, plan }) => {
        const expected = PAIRS.filter(
          (at) =>
            at.repertoireId === scenario.given &&
            scenario.playerIds.includes(at.playerId) &&
            find(scenario.after, at)?.forkedAt === FORKED_AT,
        ).map(keyOf);
        return (
          [...plan.unfork.map(keyOf)].sort().join() === expected.sort().join()
        );
      }),
    ).toStrictEqual([]);
  });

  it('lists each pair once', () => {
    expect(
      violations(({ plan }) =>
        [plan.unfork, plan.offer, plan.close].every(
          (list) => new Set(list.map(keyOf)).size === list.length,
        ),
      ),
    ).toStrictEqual([]);
  });
});
