import { moveKey, START_KEY } from '@mychess/chess';
import {
  ACCESS_REFUSALS,
  COACH_NOTE_REFUSALS,
  SHARE_REFUSALS,
} from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  coachAccessFacts,
  coachNotesOn,
  createRepertoire,
  deleteAccount,
  deleteCoachNote,
  deleteRepertoire,
  sharedCoachIds,
  setPersonalNote,
  setShares,
  shareRepertoire,
  sharedRepertoireForCoach,
  sharedRepertoireSnapshot,
  sharedWithCoach,
  unlink,
  unshareRepertoire,
  upsertCoachNote,
  type CoachNoteInput,
} from '../src';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedLink,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';
import { graphOf, LONDON, T0, T1 } from './support/repertoires';

const { db, client } = useTestDatabase();

const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

const TAIMANOV =
  '1. e4 { Taimanovo sistema } c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 *';
const E4 = moveKey(START_KEY, 'e4');
const NOT_A_MOVE = moveKey(START_KEY, 'h4');
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Rimantas coaches Gabija and Rokas; Dovydas coaches Gabija; Eglė coaches
 * nobody. Gabija owns a Taimanov and a London, Rokas a London.
 */
async function seedCoaching(): Promise<{
  taimanov: string;
  gabijaLondon: string;
  rokasLondon: string;
}> {
  for (const coach of ['rimantas', 'dovydas', 'egle'])
    await seedCoach(db, coach, `${coach}@example.lt`);
  for (const player of ['gabija', 'rokas'])
    await seedPlayer(db, player, `${player}@example.lt`);
  await seedLink(db, 'rimantas', 'gabija');
  await seedLink(db, 'rimantas', 'rokas');
  await seedLink(db, 'dovydas', 'gabija');
  const repertoire = (ownerId: string, name: string, pgn: string) =>
    createRepertoire(db, {
      ownerId,
      side: pgn === TAIMANOV ? 'black' : 'white',
      name,
      graph: graphOf(pgn, pgn === TAIMANOV ? 'black' : 'white'),
      now: T0,
    });
  return {
    taimanov: await repertoire('gabija', 'Taimanovas', TAIMANOV),
    gabijaLondon: await repertoire('gabija', 'Londono sistema', LONDON),
    rokasLondon: await repertoire('rokas', 'Londono sistema', LONDON),
  };
}

const share = (ownerId: string, repertoireId: string, coachId: string) =>
  shareRepertoire(db, { ownerId, repertoireId, coachId, now: T0 });

const note = (over: Partial<CoachNoteInput> = {}): CoachNoteInput => ({
  coachId: 'rimantas',
  playerId: 'gabija',
  repertoireId: UNKNOWN_ID,
  moveKey: E4,
  text: 'Po 2...e6 žiūrėk į d5',
  now: T0,
  ...over,
});

const noteRows = async (): Promise<unknown[]> =>
  (
    await client.query<Record<string, unknown>>(
      'select coach_id, move_key, text from coach_notes order by coach_id',
    )
  ).rows;

describe('shareRepertoire (R-42)', () => {
  it('shares an own repertoire with a linked coach, once', async () => {
    const { taimanov } = await seedCoaching();
    expect(await share('gabija', taimanov, 'rimantas')).toEqual(ok);
    expect(await share('gabija', taimanov, 'rimantas')).toEqual(ok);
    expect(await share('gabija', taimanov, 'dovydas')).toEqual(ok);
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual([
      'dovydas',
      'rimantas',
    ]);
  });

  it("refuses someone else's repertoire as not the owner's", async () => {
    const { rokasLondon } = await seedCoaching();
    expect(await share('gabija', rokasLondon, 'rimantas')).toEqual(
      refused(SHARE_REFUSALS.notOwner),
    );
    expect(await sharedCoachIds(db, 'rokas', rokasLondon)).toEqual([]);
  });

  it.each([UNKNOWN_ID, 'not-a-uuid'])(
    'refuses a repertoire that does not exist (%s)',
    async (id) => {
      await seedCoaching();
      expect(await share('gabija', id, 'rimantas')).toEqual(
        refused(SHARE_REFUSALS.notOwner),
      );
    },
  );

  it('refuses a coach the owner is not linked to', async () => {
    const { taimanov } = await seedCoaching();
    expect(await share('gabija', taimanov, 'egle')).toEqual(
      refused(SHARE_REFUSALS.notLinked),
    );
    expect(await share('rokas', taimanov, 'dovydas')).toEqual(
      refused(SHARE_REFUSALS.notOwner),
    );
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual([]);
  });
});

describe('unshareRepertoire', () => {
  it("removes only the owner's share with that coach", async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', taimanov, 'dovydas');
    await unshareRepertoire(db, {
      ownerId: 'rokas',
      repertoireId: taimanov,
      coachId: 'rimantas',
    });
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual([
      'dovydas',
      'rimantas',
    ]);
    await unshareRepertoire(db, {
      ownerId: 'gabija',
      repertoireId: taimanov,
      coachId: 'rimantas',
    });
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual(['dovydas']);
  });

  it('does nothing for a malformed repertoire id', async () => {
    await seedCoaching();
    await expect(
      unshareRepertoire(db, {
        ownerId: 'gabija',
        repertoireId: 'not-a-uuid',
        coachId: 'rimantas',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('sharedCoachIds', () => {
  it("lists a repertoire's coaches to its owner only", async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    expect(await sharedCoachIds(db, 'rokas', taimanov)).toEqual([]);
    expect(await sharedCoachIds(db, 'gabija', 'not-a-uuid')).toEqual([]);
  });
});

describe('sharedWithCoach (checklist 1-2)', () => {
  it("lists only the player's repertoires shared with this coach, by name", async () => {
    const { taimanov, gabijaLondon, rokasLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', gabijaLondon, 'dovydas');
    await share('rokas', rokasLondon, 'rimantas');
    expect(await sharedWithCoach(db, 'rimantas', 'gabija')).toEqual([
      { id: taimanov, name: 'Taimanovas', side: 'black' },
    ]);
    expect(await sharedWithCoach(db, 'dovydas', 'gabija')).toEqual([
      { id: gabijaLondon, name: 'Londono sistema', side: 'white' },
    ]);
    expect(await sharedWithCoach(db, 'egle', 'gabija')).toEqual([]);
    expect(await sharedWithCoach(db, 'dovydas', 'rokas')).toEqual([]);
  });

  it('lists nothing once unshared or unlinked', async () => {
    const { taimanov, gabijaLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', gabijaLondon, 'dovydas');
    await unshareRepertoire(db, {
      ownerId: 'gabija',
      repertoireId: taimanov,
      coachId: 'rimantas',
    });
    await unlink(db, 'dovydas', 'gabija', T1);
    expect(await sharedWithCoach(db, 'rimantas', 'gabija')).toEqual([]);
    expect(await sharedWithCoach(db, 'dovydas', 'gabija')).toEqual([]);
  });
});

describe('coachAccessFacts', () => {
  it('holds the ids shared with this coach, and none after unlink (checklist 3)', async () => {
    const { taimanov, gabijaLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', gabijaLondon, 'dovydas');
    expect(await coachAccessFacts(db, 'rimantas', 'gabija')).toEqual({
      linked: true,
      sharedRepertoireIds: new Set([taimanov]),
    });
    await unlink(db, 'rimantas', 'gabija', T1);
    expect(await coachAccessFacts(db, 'rimantas', 'gabija')).toEqual({
      linked: false,
      sharedRepertoireIds: new Set(),
    });
  });
});

describe('upsertCoachNote', () => {
  it('writes a note on a move of a shared repertoire, then replaces it', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    expect(await upsertCoachNote(db, note({ repertoireId: taimanov }))).toEqual(
      ok,
    );
    expect(
      await upsertCoachNote(
        db,
        note({ repertoireId: taimanov, text: 'Geriau 2...d6', now: T1 }),
      ),
    ).toEqual(ok);
    expect(await coachNotesOn(db, 'gabija', taimanov)).toEqual([
      {
        coachId: 'rimantas',
        coachName: 'Name rimantas',
        moveKey: E4,
        text: 'Geriau 2...d6',
        updatedAt: T1,
      },
    ]);
  });

  it('refuses a repertoire not shared with the coach, and writes nothing', async () => {
    const { taimanov, gabijaLondon } = await seedCoaching();
    await share('gabija', taimanov, 'dovydas');
    for (const repertoireId of [taimanov, gabijaLondon, UNKNOWN_ID, 'x'])
      expect(await upsertCoachNote(db, note({ repertoireId }))).toEqual(
        refused(ACCESS_REFUSALS.notShared),
      );
    expect(await noteRows()).toEqual([]);
  });

  it('refuses a coach who is not linked', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    expect(
      await upsertCoachNote(
        db,
        note({ coachId: 'egle', repertoireId: taimanov }),
      ),
    ).toEqual(refused(ACCESS_REFUSALS.notLinked));
    expect(await noteRows()).toEqual([]);
  });

  it('refuses a forged player who does not own the repertoire (checklist 4)', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    expect(
      await upsertCoachNote(
        db,
        note({ playerId: 'rokas', repertoireId: taimanov }),
      ),
    ).toEqual(refused(ACCESS_REFUSALS.notShared));
    expect(await noteRows()).toEqual([]);
  });

  it.each([NOT_A_MOVE, 'not a move key'])(
    'refuses a move the repertoire does not have (%s)',
    async (key) => {
      const { taimanov } = await seedCoaching();
      await share('gabija', taimanov, 'rimantas');
      expect(
        await upsertCoachNote(
          db,
          note({ repertoireId: taimanov, moveKey: key }),
        ),
      ).toEqual(refused(COACH_NOTE_REFUSALS.moveNotFound));
      expect(await noteRows()).toEqual([]);
    },
  );

  it('waits for an unshare in progress and then writes nothing', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    const unsharing = await openTransaction(client, [
      `delete from repertoire_shares where coach_id = 'rimantas'`,
    ]);
    const writing = upsertCoachNote(db, note({ repertoireId: taimanov }));
    await someoneWaitsForALock(client);
    await unsharing.finish();
    expect(await writing).toEqual(refused(ACCESS_REFUSALS.notShared));
    expect(await noteRows()).toEqual([]);
  });

  it('waits for an unlink in progress and then writes nothing', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    const unlinking = await openTransaction(client, [
      `delete from coach_links where coach_id = 'rimantas' and player_id = 'gabija'`,
    ]);
    const writing = upsertCoachNote(db, note({ repertoireId: taimanov }));
    await someoneWaitsForALock(client);
    await unlinking.finish();
    expect(await writing).toEqual(refused(ACCESS_REFUSALS.notLinked));
    expect(await noteRows()).toEqual([]);
  });
});

describe('deleteCoachNote', () => {
  const remove = (over: Partial<CoachNoteInput>) =>
    deleteCoachNote(db, {
      coachId: 'rimantas',
      playerId: 'gabija',
      repertoireId: UNKNOWN_ID,
      moveKey: E4,
      ...over,
    });

  it("removes only the coach's own note", async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', taimanov, 'dovydas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await upsertCoachNote(
      db,
      note({ coachId: 'dovydas', repertoireId: taimanov, text: 'Gerai' }),
    );
    expect(
      await remove({ coachId: 'dovydas', repertoireId: taimanov }),
    ).toEqual(ok);
    expect(await noteRows()).toEqual([
      { coach_id: 'rimantas', move_key: E4, text: 'Po 2...e6 žiūrėk į d5' },
    ]);
  });

  it.each([
    [
      'a coach not linked to the player',
      { coachId: 'egle' },
      ACCESS_REFUSALS.notLinked,
    ],
    [
      'a player who does not own it',
      { playerId: 'rokas' },
      ACCESS_REFUSALS.notShared,
    ],
    [
      'a repertoire that does not exist',
      { repertoireId: UNKNOWN_ID },
      ACCESS_REFUSALS.notShared,
    ],
    [
      'a malformed repertoire id',
      { repertoireId: 'not-a-uuid' },
      ACCESS_REFUSALS.notShared,
    ],
  ] as const)('refuses %s and removes nothing', async (_case, over, reason) => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    expect(await remove({ repertoireId: taimanov, ...over })).toEqual(
      refused(reason),
    );
    expect(await noteRows()).toHaveLength(1);
  });

  it('refuses a repertoire shared only with another coach', async () => {
    const { gabijaLondon } = await seedCoaching();
    await share('gabija', gabijaLondon, 'dovydas');
    expect(await remove({ repertoireId: gabijaLondon })).toEqual(
      refused(ACCESS_REFUSALS.notShared),
    );
  });

  it('waits for an unshare in progress and then is refused', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    const unsharing = await openTransaction(client, [
      `delete from repertoire_shares where coach_id = 'rimantas'`,
    ]);
    const removing = remove({ repertoireId: taimanov });
    await someoneWaitsForALock(client);
    await unsharing.finish();
    expect(await removing).toEqual(refused(ACCESS_REFUSALS.notShared));
  });
});

describe('setShares (R-42)', () => {
  const set = (
    ownerId: string,
    repertoireId: string,
    coachIds: readonly string[],
  ) => setShares(db, { ownerId, repertoireId, coachIds, now: T0 });

  it('shares with exactly the coaches named, and says how many', async () => {
    const { taimanov } = await seedCoaching();
    expect(await set('gabija', taimanov, ['rimantas'])).toEqual({
      ok: true,
      value: { shared: 1 },
    });
    expect(
      await set('gabija', taimanov, ['dovydas', 'rimantas', 'dovydas']),
    ).toEqual({ ok: true, value: { shared: 2 } });
    expect(await set('gabija', taimanov, ['dovydas'])).toEqual({
      ok: true,
      value: { shared: 1 },
    });
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual(['dovydas']);
    expect(await set('gabija', taimanov, [])).toEqual({
      ok: true,
      value: { shared: 0 },
    });
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual([]);
  });

  it('ends a share and its coach notes together (R-124)', async () => {
    const { taimanov } = await seedCoaching();
    await set('gabija', taimanov, ['rimantas', 'dovydas']);
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await set('gabija', taimanov, ['dovydas']);
    expect(await noteRows()).toEqual([]);
  });

  it('shares with the linked coaches named and refuses the others', async () => {
    const { taimanov } = await seedCoaching();
    expect(
      await set('gabija', taimanov, ['egle', 'rimantas', 'gabija']),
    ).toEqual({
      ok: true,
      value: {
        shared: 1,
        refusal: { reason: SHARE_REFUSALS.notLinked },
      },
    });
    expect(await sharedCoachIds(db, 'gabija', taimanov)).toEqual(['rimantas']);
  });

  it.each([
    ['with coaches', ['rimantas']],
    ['with none', []],
  ])(
    "refuses someone else's repertoire %s and changes nothing",
    async (_case, coachIds) => {
      const { rokasLondon } = await seedCoaching();
      await share('rokas', rokasLondon, 'rimantas');
      expect(await set('gabija', rokasLondon, coachIds)).toEqual(
        refused(SHARE_REFUSALS.notOwner),
      );
      expect(await sharedCoachIds(db, 'rokas', rokasLondon)).toEqual([
        'rimantas',
      ]);
    },
  );

  it.each([UNKNOWN_ID, 'not-a-uuid'])(
    'refuses a repertoire that does not exist (%s)',
    async (id) => {
      await seedCoaching();
      expect(await set('gabija', id, [])).toEqual(
        refused(SHARE_REFUSALS.notOwner),
      );
    },
  );

  it('waits on the link before the repertoire, the order a deleteAccount takes them', async () => {
    const { taimanov } = await seedCoaching();
    const deleting = await openTransaction(client, [
      `select 1 from coach_links where coach_id = 'rimantas' and player_id = 'gabija' for update`,
    ]);
    const sharing = set('gabija', taimanov, ['rimantas']);
    await someoneWaitsForALock(client);
    await deleting.finish(`delete from accounts where id = 'gabija'`);
    expect(await sharing).toEqual(refused(SHARE_REFUSALS.notOwner));
    expect(
      (await client.query('select count(*)::int as n from repertoire_shares'))
        .rows,
    ).toEqual([{ n: 0 }]);
  });
});

describe('coachNotesOn', () => {
  it("returns every coach's notes, with names, by move then coach, to the owner only", async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', taimanov, 'dovydas');
    const c5 = moveKey(graphOf(TAIMANOV, 'black').moves[1]?.from ?? '', 'c5');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await upsertCoachNote(
      db,
      note({ repertoireId: taimanov, moveKey: c5, text: 'Sicilija' }),
    );
    await upsertCoachNote(
      db,
      note({ coachId: 'dovydas', repertoireId: taimanov, text: 'Gerai' }),
    );
    // A move key starts with its position; c5's ("…/4P3/…") sorts before e4's.
    expect(
      (await coachNotesOn(db, 'gabija', taimanov)).map((n) => [
        n.moveKey,
        n.coachName,
        n.text,
      ]),
    ).toEqual([
      [c5, 'Name rimantas', 'Sicilija'],
      [E4, 'Name dovydas', 'Gerai'],
      [E4, 'Name rimantas', 'Po 2...e6 žiūrėk į d5'],
    ]);
    expect(await coachNotesOn(db, 'rokas', taimanov)).toEqual([]);
    expect(await coachNotesOn(db, 'gabija', 'not-a-uuid')).toEqual([]);
  });
});

describe('sharedRepertoireForCoach (checklist 2)', () => {
  it('loads a shared repertoire with its comments and the coach’s own notes, never personal notes', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', taimanov, 'dovydas');
    await setPersonalNote(db, {
      playerId: 'gabija',
      repertoireId: taimanov,
      moveKey: E4,
      text: 'Slapta mano pastaba',
      now: T0,
    });
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await upsertCoachNote(
      db,
      note({ coachId: 'dovydas', repertoireId: taimanov, text: 'Dovydo' }),
    );
    const loaded = await sharedRepertoireForCoach(
      db,
      'rimantas',
      'gabija',
      taimanov,
    );
    expect(loaded?.repertoire).toMatchObject({
      id: taimanov,
      ownerId: 'gabija',
      name: 'Taimanovas',
      side: 'black',
    });
    expect(loaded?.graph.moves.find((m) => m.san === 'e4')?.comment).toBe(
      'Taimanovo sistema',
    );
    expect(loaded?.notes).toEqual([
      {
        coachId: 'rimantas',
        coachName: 'Name rimantas',
        moveKey: E4,
        text: 'Po 2...e6 žiūrėk į d5',
        updatedAt: T0,
      },
    ]);
    expect(JSON.stringify(loaded)).not.toMatch(/Slapta|Dovydo/);
  });

  it('loads nothing unshared, foreign, unlinked or malformed', async () => {
    const { taimanov, gabijaLondon, rokasLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('rokas', rokasLondon, 'rimantas');
    const load = (coachId: string, playerId: string, id: string) =>
      sharedRepertoireForCoach(db, coachId, playerId, id);
    expect(await load('rimantas', 'gabija', gabijaLondon)).toBeUndefined();
    expect(await load('rimantas', 'gabija', rokasLondon)).toBeUndefined();
    expect(await load('rimantas', 'rokas', taimanov)).toBeUndefined();
    expect(await load('dovydas', 'gabija', taimanov)).toBeUndefined();
    expect(await load('rimantas', 'gabija', 'not-a-uuid')).toBeUndefined();
    await unlink(db, 'rimantas', 'gabija', T1);
    expect(await load('rimantas', 'gabija', taimanov)).toBeUndefined();
  });
});

describe('sharedRepertoireSnapshot (#278: the coach page in one snapshot)', () => {
  it('reads the access facts, the shared repertoire and the player together', async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    const snapshot = await sharedRepertoireSnapshot(
      db,
      'rimantas',
      'gabija',
      taimanov,
    );
    expect(snapshot.facts).toEqual({
      linked: true,
      sharedRepertoireIds: new Set([taimanov]),
    });
    expect(snapshot.player).toMatchObject({
      id: 'gabija',
      displayName: 'Name gabija',
    });
    expect(snapshot.shared?.repertoire).toMatchObject({
      id: taimanov,
      name: 'Taimanovas',
    });
    expect(snapshot.shared?.notes.map((n) => n.coachId)).toEqual(['rimantas']);
  });

  it('reads no repertoire unshared or malformed, and nothing once unlinked', async () => {
    const { taimanov, gabijaLondon, rokasLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    const read = (id: string) =>
      sharedRepertoireSnapshot(db, 'rimantas', 'gabija', id);
    expect(await read(gabijaLondon)).toMatchObject({
      facts: { linked: true },
      player: { id: 'gabija' },
      shared: undefined,
    });
    expect((await read(rokasLondon)).shared).toBeUndefined();
    expect((await read('not-a-uuid')).shared).toBeUndefined();
    await unlink(db, 'rimantas', 'gabija', T1);
    expect(await read(taimanov)).toEqual({
      facts: { linked: false, sharedRepertoireIds: new Set() },
      player: undefined,
      shared: undefined,
    });
  });
});

describe('deleting with shares and notes', () => {
  const counts = async (): Promise<unknown> =>
    (
      await client.query(`select
        (select count(*) from repertoire_shares)::int as shares,
        (select count(*) from coach_notes)::int as notes`)
    ).rows[0];

  it("removes the coach's shares and notes with the coach's account", async () => {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await deleteAccount(db, 'rimantas');
    expect(await counts()).toEqual({ shares: 0, notes: 0 });
  });

  it("removes the repertoire's shares and notes with the owner's account or the repertoire", async () => {
    const { taimanov, rokasLondon } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await share('rokas', rokasLondon, 'rimantas');
    await upsertCoachNote(
      db,
      note({
        playerId: 'rokas',
        repertoireId: rokasLondon,
        moveKey: moveKey(START_KEY, 'd4'),
      }),
    );
    await deleteAccount(db, 'gabija');
    expect(await counts()).toEqual({ shares: 1, notes: 1 });
    await deleteRepertoire(db, rokasLondon, 'rokas', T1);
    expect(await counts()).toEqual({ shares: 0, notes: 0 });
  });
});

describe('ending a share ends its coach notes (R-124)', () => {
  async function notedTwice(): Promise<string> {
    const { taimanov } = await seedCoaching();
    await share('gabija', taimanov, 'rimantas');
    await share('gabija', taimanov, 'dovydas');
    await upsertCoachNote(db, note({ repertoireId: taimanov }));
    await upsertCoachNote(
      db,
      note({ coachId: 'dovydas', repertoireId: taimanov, text: 'Gerai' }),
    );
    return taimanov;
  }

  it("unsharing deletes that coach's notes on the repertoire, and only theirs", async () => {
    const taimanov = await notedTwice();
    await unshareRepertoire(db, {
      ownerId: 'gabija',
      repertoireId: taimanov,
      coachId: 'rimantas',
    });
    expect(
      (await coachNotesOn(db, 'gabija', taimanov)).map((n) => n.coachId),
    ).toEqual(['dovydas']);
  });

  it("unlinking deletes the coach's notes on the player's repertoires", async () => {
    const taimanov = await notedTwice();
    await unlink(db, 'rimantas', 'gabija', T1);
    expect(
      (await coachNotesOn(db, 'gabija', taimanov)).map((n) => n.coachId),
    ).toEqual(['dovydas']);
    expect(await noteRows()).toEqual([
      { coach_id: 'dovydas', move_key: E4, text: 'Gerai' },
    ]);
  });

  it('sharing again starts with no notes', async () => {
    const taimanov = await notedTwice();
    await unshareRepertoire(db, {
      ownerId: 'gabija',
      repertoireId: taimanov,
      coachId: 'rimantas',
    });
    await share('gabija', taimanov, 'rimantas');
    expect(
      (await sharedRepertoireForCoach(db, 'rimantas', 'gabija', taimanov))
        ?.notes,
    ).toEqual([]);
  });
});

describe('shareRepertoire against a deleteAccount of the owner', () => {
  it('waits on the link before the repertoire, the order the delete takes them, so neither deadlocks', async () => {
    const { taimanov } = await seedCoaching();
    // The delete has reached the link; it goes on to the repertoire next.
    const deleting = await openTransaction(client, [
      `select 1 from coach_links where coach_id = 'rimantas' and player_id = 'gabija' for update`,
    ]);
    const sharing = share('gabija', taimanov, 'rimantas');
    await someoneWaitsForALock(client);
    await deleting.finish(`delete from accounts where id = 'gabija'`);
    expect(await sharing).toEqual(refused(SHARE_REFUSALS.notOwner));
    expect(
      (await client.query('select count(*)::int as n from repertoire_shares'))
        .rows,
    ).toEqual([{ n: 0 }]);
  });
});
