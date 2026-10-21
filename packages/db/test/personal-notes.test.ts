import { moveKey, removeMove, START_KEY } from '@mychess/chess';
import { REPERTOIRE_REFUSALS } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  deleteRepertoire,
  listPersonalNotes,
  saveRepertoireEdit,
  setPersonalNote,
} from '../src';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';
import { graphOf, LONDON, T0, T1 } from './support/repertoires';

const { db, client } = useTestDatabase();

const D4 = moveKey(START_KEY, 'd4');
const DONE = { ok: true, value: undefined };
const NOT_FOUND = {
  ok: false,
  refusal: { reason: REPERTOIRE_REFUSALS.notFound },
};

async function london(): Promise<string> {
  await seedAccount(db, 'rokas', 'rokas@example.lt');
  return createRepertoire(db, {
    ownerId: 'rokas',
    side: 'white',
    name: 'Londono sistema',
    graph: graphOf(LONDON),
    now: T0,
  });
}

const note = (playerId: string, repertoireId: string, text: string, now = T0) =>
  setPersonalNote(db, { playerId, repertoireId, moveKey: D4, text, now });

const noteRows = async (): Promise<unknown> =>
  (
    await client.query(
      'select player_account_id, move_key, text, updated_at from personal_notes order by player_account_id',
    )
  ).rows;

describe('setPersonalNote and listPersonalNotes', () => {
  it('sets a note, replaces it, and removes it with empty text', async () => {
    const id = await london();
    await note('rokas', id, 'Nepamiršti d3');
    expect(await listPersonalNotes(db, 'rokas', id)).toEqual({
      [D4]: 'Nepamiršti d3',
    });
    await note('rokas', id, 'Nepamiršti c4', T1);
    expect(await noteRows()).toEqual([
      {
        player_account_id: 'rokas',
        move_key: D4,
        text: 'Nepamiršti c4',
        updated_at: T1,
      },
    ]);
    await note('rokas', id, '');
    expect(await listPersonalNotes(db, 'rokas', id)).toEqual({});
    expect(await noteRows()).toEqual([]);
  });

  it('says a note was set or removed', async () => {
    const id = await london();
    expect(await note('rokas', id, 'Nepamiršti d3')).toEqual(DONE);
    expect(await note('rokas', id, '')).toEqual(DONE);
  });

  it.each([
    ['sets', 'Rimantas'],
    ['removes', ''],
  ])(
    "refuses a player who %s a note on someone else's repertoire, and writes nothing",
    async (_, text) => {
      const id = await london();
      await seedAccount(db, 'rimantas', 'rimantas@example.lt');
      await note('rokas', id, 'Rokas');
      expect(await note('rimantas', id, text)).toEqual(NOT_FOUND);
      expect(await noteRows()).toEqual([
        {
          player_account_id: 'rokas',
          move_key: D4,
          text: 'Rokas',
          updated_at: T0,
        },
      ]);
    },
  );

  it.each([
    ['a missing repertoire', '00000000-0000-4000-8000-000000000001'],
    ['an id that is no uuid', 'not-a-uuid'],
  ])('refuses a note on %s as not found', async (_, id) => {
    await london();
    expect(await note('rokas', id, 'Nepamiršti')).toEqual(NOT_FOUND);
    expect(await noteRows()).toEqual([]);
  });

  it('refuses a note on a move the repertoire does not have, and writes nothing (decision 11)', async () => {
    const id = await london();
    const e4 = moveKey(START_KEY, 'e4');
    const write = (key: string, text: string) =>
      setPersonalNote(db, {
        playerId: 'rokas',
        repertoireId: id,
        moveKey: key,
        text,
        now: T0,
      });
    expect(await write(e4, 'Ne šito')).toEqual(NOT_FOUND);
    expect(await write('ne-raktas', 'Ne šito')).toEqual(NOT_FOUND);
    expect(await noteRows()).toEqual([]);
    expect(await write(e4, '')).toEqual(DONE);
  });

  it("never lists another player's note, nor notes on a repertoire the player may not view", async () => {
    const id = await london();
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    await note('rokas', id, 'Rokas');
    expect(await listPersonalNotes(db, 'rimantas', id)).toEqual({});
    // A row no write path makes today: the read still filters by access.
    await client.query(
      `insert into personal_notes (player_account_id, repertoire_id, move_key, text, updated_at)
       values ('rimantas', $1, $2, 'Rimantas', $3)`,
      [id, D4, T0],
    );
    expect(await listPersonalNotes(db, 'rimantas', id)).toEqual({});
    expect(await listPersonalNotes(db, 'rokas', id)).toEqual({ [D4]: 'Rokas' });
  });

  it('lists nothing for an id that is no uuid', async () => {
    await london();
    expect(await listPersonalNotes(db, 'rokas', 'not-a-uuid')).toEqual({});
  });

  it('keeps a note when its move is removed, and drops it with the repertoire', async () => {
    const id = await london();
    await note('rokas', id, 'Nepamiršti');
    const before = graphOf(LONDON);
    const without1 = removeMove(before, 'c1', START_KEY, 'd4');
    if (!without1.ok) throw new Error(without1.refusal.reason);
    const without = removeMove(without1.value, 'c2', START_KEY, 'd4');
    if (!without.ok) throw new Error(without.refusal.reason);
    await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: without.value,
      now: T1,
    });
    expect(
      (await client.query('select count(*)::int as n from repertoire_moves'))
        .rows,
    ).toEqual([{ n: 0 }]);
    expect(await listPersonalNotes(db, 'rokas', id)).toEqual({
      [D4]: 'Nepamiršti',
    });
    await deleteRepertoire(db, id, 'rokas', T1);
    expect(await noteRows()).toEqual([]);
  });
});
