import { moveKey, removeMove, START_KEY } from '@mychess/chess';
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

  it("never lists another player's note, and keeps each player's own", async () => {
    const id = await london();
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    await note('rokas', id, 'Rokas');
    expect(await listPersonalNotes(db, 'rimantas', id)).toEqual({});
    await note('rimantas', id, 'Rimantas');
    expect(await listPersonalNotes(db, 'rokas', id)).toEqual({ [D4]: 'Rokas' });
    expect(await listPersonalNotes(db, 'rimantas', id)).toEqual({
      [D4]: 'Rimantas',
    });
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
      before,
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
    await deleteRepertoire(db, id, 'rokas');
    expect(await noteRows()).toEqual([]);
  });
});
