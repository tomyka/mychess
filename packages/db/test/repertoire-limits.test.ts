import type { RepertoireGraph, RepertoireMove } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  editRepertoire,
  loadRepertoire,
  mayAddRepertoire,
} from '../src';
import { createRepertoireBeyondLimits } from '../src/repertoires/repository';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';
import {
  graphOf,
  graphWithMoves,
  seedRepertoireRows,
  T0,
  T1,
} from './support/repertoires';

const { db, client } = useTestDatabase();

const OK = { ok: true, value: undefined };
const AT_LIMIT = {
  ok: false,
  refusal: { reason: 'repertoire.limit', limit: 50 },
};
const TOO_MANY_MOVES = {
  ok: false,
  refusal: { reason: 'repertoire.tooManyMoves', limit: 5000 },
};
const ROKAS = { id: 'rokas', entitlement: 'free' } as const;

const create = (graph: RepertoireGraph, beyondLimits?: true) =>
  (beyondLimits === true ? createRepertoireBeyondLimits : createRepertoire)(
    db,
    {
      ownerId: 'rokas',
      side: 'white',
      name: 'Londono sistema',
      graph,
      now: T0,
    },
  );

const owned = async (): Promise<number> => {
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from repertoires where owner_account_id = 'rokas'`,
  );
  return rows[0]?.n ?? -1;
};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function idOf(result: { ok: true; value: string } | { ok: false }): string {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

describe('createRepertoire within the R-162 limits', () => {
  it('creates a 50th repertoire and refuses a 51st, writing nothing', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedRepertoireRows(db, 'rokas', 49);
    expect(await create(graphOf('1. d4 *'))).toMatchObject({ ok: true });
    expect(await create(graphOf('1. e4 *'))).toEqual(AT_LIMIT);
    expect(await owned()).toBe(50);
  });

  it('creates a repertoire of 5,000 moves and refuses one of 5,001, writing nothing', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = idOf(await create(graphWithMoves(5000)));
    expect(
      must(await loadRepertoire(db, id, 'rokas')).graph.moves,
    ).toHaveLength(5000);
    expect(await create(graphWithMoves(5001))).toEqual(TOO_MANY_MOVES);
    expect(await owned()).toBe(1);
  });

  it('creates past both limits only for the automatic fork (R-163)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedRepertoireRows(db, 'rokas', 50);
    expect(await create(graphWithMoves(5001), true)).toMatchObject({
      ok: true,
    });
    expect(await owned()).toBe(51);
  });

  it('throws for an owner with no account', async () => {
    await expect(create(graphOf('1. d4 *'))).rejects.toThrow();
  });

  it.each([1, 2, 3])(
    'ends with exactly 50 repertoires when two creations race at 49, run %i',
    async () => {
      await seedAccount(db, 'rokas', 'rokas@example.lt');
      await seedRepertoireRows(db, 'rokas', 49);
      const results = await Promise.all([
        create(graphOf('1. d4 *')),
        create(graphOf('1. e4 *')),
      ]);
      expect(results.filter((r) => !r.ok)).toEqual([AT_LIMIT]);
      expect(await owned()).toBe(50);
    },
  );
});

describe('mayAddRepertoire', () => {
  it('allows a 50th repertoire and refuses a 51st (R-162)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedRepertoireRows(db, 'rokas', 49);
    expect(await mayAddRepertoire(db, ROKAS)).toEqual(OK);
    await seedRepertoireRows(db, 'rokas', 1);
    expect(await mayAddRepertoire(db, ROKAS)).toEqual(AT_LIMIT);
  });

  it("counts only the owner's own repertoires", async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    await seedRepertoireRows(db, 'rimantas', 50);
    expect(await mayAddRepertoire(db, ROKAS)).toEqual(OK);
  });
});

describe('editRepertoire within the R-162 move limit', () => {
  /** Rokas adds or removes `move` in the one chapter of `graph`, from version 1. */
  const edit = (
    id: string,
    graph: RepertoireGraph,
    kind: 'addMove' | 'removeMove',
    move: Pick<RepertoireMove, 'from' | 'san'>,
  ) =>
    editRepertoire(db, {
      id,
      viewer: ROKAS,
      expectedVersion: 1,
      change: {
        kind: 'edit',
        op: {
          kind,
          chapterId: must(graph.chapters[0]).id,
          from: move.from,
          san: move.san,
        },
      },
      now: T1,
    });

  it('refuses a 5,001st move, writing nothing', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const graph = graphWithMoves(5000);
    const id = idOf(await create(graph));
    // The generator grows one move at a time, so 5,001 is 5,000 and one more.
    const next = must(
      graphWithMoves(5001).moves.find(
        (m) => !graph.moves.some((n) => n.from === m.from && n.san === m.san),
      ),
    );
    expect(await edit(id, graph, 'addMove', next)).toEqual(TOO_MANY_MOVES);
    const stored = must(await loadRepertoire(db, id, 'rokas'));
    expect(stored.repertoire.version).toBe(1);
    expect(stored.graph.moves).toHaveLength(5000);
  });

  it('allows removing a move from a repertoire over the limit', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const graph = graphWithMoves(5001);
    const id = idOf(await create(graph, true));
    const leaf = must(
      graph.moves.find((m) => !graph.moves.some((n) => n.from === m.to)),
    );
    expect(await edit(id, graph, 'removeMove', leaf)).toMatchObject({
      ok: true,
      value: { version: 2 },
    });
    expect(
      must(await loadRepertoire(db, id, 'rokas')).graph.moves,
    ).toHaveLength(5000);
  });
});
