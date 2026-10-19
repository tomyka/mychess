// A coach's view of a shared repertoire, with coach notes (S4 Task B6,
// R-42, R-102, R-107, R-125, R-21): the coach is always the session
// account, notes land only on a repertoire shared with them, and the view
// never carries the player's personal notes.
import { moveKey, START_KEY } from '@mychess/chess';
import {
  setPersonalNote,
  shareRepertoire,
  unshareRepertoire,
} from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteCoachNoteAction,
  saveCoachNoteAction,
} from '../../src/app/treneris/actions';
import {
  coachPlayerData,
  sharedRepertoireData,
} from '../../src/server/coach-pages';
import { repertoirePageData } from '../../src/server/repertoires';
import {
  actAs,
  coachPerson,
  link,
  person,
  type Person,
} from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, testDb } from './support/request';
import { LONDON, seedRepertoire, TAIMANOV } from './support/repertoires';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('next/cache', async () =>
  (await import('./support/request')).nextCache(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

const E4 = moveKey(START_KEY, 'e4');
const D4 = moveKey(START_KEY, 'd4');

/** A well-formed repertoire id that names nothing. */
const NO_SUCH_REPERTOIRE = '00000000-0000-4000-8000-000000000000';

/** Repertoires Rimantas may not write on: [case, repertoire of the cast]. */
const NOT_SHARED_WITH_RIMANTAS = [
  ['shared only with another coach', (c: Cast) => c.london],
  ['that does not exist', () => NO_SUCH_REPERTOIRE],
] as const;

interface Cast {
  /** Coach, linked to Gabija and Rokas. */
  readonly rimantas: Person;
  /** Coach, linked to Gabija. */
  readonly dovydas: Person;
  readonly gabija: Person;
  readonly rokas: Person;
  /** Gabija's Taimanov, shared with both coaches; her note on 1. e4. */
  readonly taimanov: string;
  /** Gabija's London, shared with Dovydas only. */
  readonly london: string;
}

async function share(owner: Person, repertoireId: string, coach: Person) {
  const shared = await shareRepertoire(testDb(), {
    ownerId: owner.id,
    repertoireId,
    coachId: coach.id,
    now: new Date(),
  });
  if (!shared.ok) throw new Error(shared.refusal.reason);
}

async function cast(): Promise<Cast> {
  const rimantas = await coachPerson(sql, 'rimantas@example.lt', 'Rimantas');
  const dovydas = await coachPerson(sql, 'dovydas@example.lt', 'Dovydas');
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  await link(rimantas.id, gabija.id);
  await link(dovydas.id, gabija.id);
  await link(rimantas.id, rokas.id);
  const taimanov = await seedRepertoire(testDb(), 'gabija@example.lt', {
    pgn: TAIMANOV,
    side: 'black',
    name: 'Taimanovas',
  });
  const london = await seedRepertoire(testDb(), 'gabija@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  await share(gabija, taimanov, rimantas);
  await share(gabija, taimanov, dovydas);
  await share(gabija, london, dovydas);
  const noted = await setPersonalNote(testDb(), {
    playerId: gabija.id,
    repertoireId: taimanov,
    moveKey: E4,
    text: 'Slaptas Gabijos užrašas',
    now: new Date(),
  });
  if (!noted.ok) throw new Error(noted.refusal.reason);
  return { rimantas, dovydas, gabija, rokas, taimanov, london };
}

/** Every coach note as coach name, move key and text. */
const notes = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as coach, n.move_key as "moveKey", n.text
       from coach_notes n join accounts a on a.id = n.coach_id
      order by 1, 2`,
  );

describe('saveCoachNoteAction (R-42)', () => {
  it('saves the coach’s note, which the player sees with the coach’s name (R-107)', async () => {
    const { rimantas, gabija, taimanov } = await cast();
    actAs(rimantas);
    const note = { playerId: gabija.id, repertoireId: taimanov, moveKey: E4 };
    expect(
      await outcomeOf(saveCoachNoteAction({ ...note, text: '  Pirma  ' })),
    ).toEqual({});
    expect(
      await outcomeOf(saveCoachNoteAction({ ...note, text: 'Antra' })),
    ).toEqual({});
    expect(await notes()).toEqual([
      { coach: 'Rimantas', moveKey: E4, text: 'Antra' },
    ]);
    expect(await outcomeOf(sharedRepertoireData(gabija.id, taimanov))).toEqual(
      expect.objectContaining({ notes: { [E4]: 'Antra' } }),
    );
    actAs(gabija);
    expect((await repertoirePageData(taimanov)).coachNotes).toEqual([
      {
        coachId: rimantas.id,
        coachName: 'Rimantas',
        moveKey: E4,
        text: 'Antra',
      },
    ]);
  });

  it.each(NOT_SHARED_WITH_RIMANTAS)(
    'refuses a repertoire %s and writes nothing',
    async (_case, repertoire) => {
      const c = await cast();
      actAs(c.rimantas);
      expect(
        await outcomeOf(
          saveCoachNoteAction({
            playerId: c.gabija.id,
            repertoireId: repertoire(c),
            moveKey: D4,
            text: 'Pastaba',
          }),
        ),
      ).toEqual({ refusal: 'access.notShared' });
      expect(await notes()).toEqual([]);
    },
  );

  it('ignores a forged player who does not own the repertoire (checklist 4)', async () => {
    const { rimantas, rokas, taimanov } = await cast();
    actAs(rimantas);
    expect(
      await outcomeOf(
        saveCoachNoteAction({
          playerId: rokas.id,
          repertoireId: taimanov,
          moveKey: E4,
          text: 'Pastaba',
        }),
      ),
    ).toEqual({ refusal: 'access.notShared' });
    expect(await notes()).toEqual([]);
  });

  it.each([
    ['a blank note', { text: '   ' }, 'coachNote.blank'],
    ['a note too long', { text: 'a'.repeat(2001) }, 'coachNote.tooLong'],
    ['a move the repertoire lacks', { moveKey: D4 }, 'coachNote.moveNotFound'],
    ['a malformed move key', { moveKey: '' }, 'coachNote.moveNotFound'],
    ['a malformed repertoire id', { repertoireId: 'nėra' }, 'access.notShared'],
    ['a malformed player id', { playerId: '' }, 'access.notLinked'],
  ] as const)(
    'refuses %s and writes nothing',
    async (_case, change, refusal) => {
      const { rimantas, gabija, taimanov } = await cast();
      actAs(rimantas);
      expect(
        await outcomeOf(
          saveCoachNoteAction({
            playerId: gabija.id,
            repertoireId: taimanov,
            moveKey: E4,
            text: 'Pastaba',
            ...change,
          }),
        ),
      ).toEqual({ refusal });
      expect(await notes()).toEqual([]);
    },
  );

  it('refuses after the share ends, and the note went with it (R-124)', async () => {
    const { rimantas, gabija, taimanov } = await cast();
    actAs(rimantas);
    const note = { playerId: gabija.id, repertoireId: taimanov, moveKey: E4 };
    await outcomeOf(saveCoachNoteAction({ ...note, text: 'Pastaba' }));
    expect(await notes()).toHaveLength(1);
    await unshareRepertoire(testDb(), {
      ownerId: gabija.id,
      repertoireId: taimanov,
      coachId: rimantas.id,
    });
    expect(await notes()).toEqual([]);
    expect(
      await outcomeOf(saveCoachNoteAction({ ...note, text: 'Vėl' })),
    ).toEqual({ refusal: 'access.notShared' });
    expect(await notes()).toEqual([]);
  });
});

describe('deleteCoachNoteAction', () => {
  it('removes only the coach’s own note', async () => {
    const { rimantas, dovydas, gabija, taimanov } = await cast();
    const note = { playerId: gabija.id, repertoireId: taimanov, moveKey: E4 };
    actAs(dovydas);
    await outcomeOf(saveCoachNoteAction({ ...note, text: 'Dovydo' }));
    actAs(rimantas);
    await outcomeOf(saveCoachNoteAction({ ...note, text: 'Rimanto' }));
    expect(await outcomeOf(deleteCoachNoteAction(note))).toEqual({});
    expect(await notes()).toEqual([
      { coach: 'Dovydas', moveKey: E4, text: 'Dovydo' },
    ]);
  });

  it('refuses a forged player who does not own the repertoire', async () => {
    const { rimantas, rokas, taimanov } = await cast();
    actAs(rimantas);
    expect(
      await outcomeOf(
        deleteCoachNoteAction({
          playerId: rokas.id,
          repertoireId: taimanov,
          moveKey: E4,
        }),
      ),
    ).toEqual({ refusal: 'access.notShared' });
  });

  it.each(NOT_SHARED_WITH_RIMANTAS)(
    'refuses a repertoire %s and removes nothing',
    async (_case, repertoire) => {
      const c = await cast();
      actAs(c.dovydas);
      const note = {
        playerId: c.gabija.id,
        repertoireId: c.london,
        moveKey: D4,
      };
      await outcomeOf(saveCoachNoteAction({ ...note, text: 'Dovydo' }));
      actAs(c.rimantas);
      expect(
        await outcomeOf(
          deleteCoachNoteAction({ ...note, repertoireId: repertoire(c) }),
        ),
      ).toEqual({ refusal: 'access.notShared' });
      expect(await notes()).toEqual([
        { coach: 'Dovydas', moveKey: D4, text: 'Dovydo' },
      ]);
    },
  );
});

describe('sharedRepertoireData (the coach’s read-only view)', () => {
  it('shows the repertoire with its move comments and only the coach’s own notes (R-102, R-125)', async () => {
    const { rimantas, dovydas, gabija, taimanov } = await cast();
    const note = { playerId: gabija.id, repertoireId: taimanov, moveKey: E4 };
    actAs(dovydas);
    await outcomeOf(saveCoachNoteAction({ ...note, text: 'Dovydo' }));
    actAs(rimantas);
    const data = await sharedRepertoireData(gabija.id, taimanov);
    expect(data.player).toEqual({ id: gabija.id, displayName: 'Gabija' });
    expect(data.repertoire).toEqual({
      id: taimanov,
      name: 'Taimanovas',
      side: 'black',
    });
    expect(data.notes).toEqual({});
    expect(data.graph.moves.map((move) => move.comment)).toContain(
      'The main line',
    );
    expect(JSON.stringify(data)).not.toContain('Dovydo');
  });

  it('never carries the player’s personal notes (R-21, checklist 2)', async () => {
    const { rimantas, gabija, taimanov } = await cast();
    actAs(rimantas);
    const data = await outcomeOf(sharedRepertoireData(gabija.id, taimanov));
    expect(JSON.stringify(data)).not.toContain('Slaptas Gabijos užrašas');
  });

  it.each([
    ['a malformed repertoire id', (c: Cast) => [c.gabija.id, 'nėra']],
    ['a malformed player id', (c: Cast) => ['', c.taimanov]],
    ['a forged player', (c: Cast) => [c.rokas.id, c.taimanov]],
    [
      'a repertoire shared only with another coach',
      (c: Cast) => [c.gabija.id, c.london],
    ],
    [
      'a well-formed id that names no repertoire',
      (c: Cast) => [c.gabija.id, NO_SUCH_REPERTOIRE],
    ],
  ] as const)('is 404 for %s', async (_case, ids) => {
    const c = await cast();
    actAs(c.rimantas);
    const [playerId, repertoireId] = ids(c);
    expect(
      await outcomeOf(sharedRepertoireData(playerId, repertoireId)),
    ).toEqual({ notFound: true });
  });
});

describe('the coach’s player page', () => {
  it('lists the player’s repertoires shared with the coach, and no others', async () => {
    const { rimantas, gabija, taimanov } = await cast();
    actAs(rimantas);
    expect(await outcomeOf(coachPlayerData(gabija.id))).toMatchObject({
      displayName: 'Gabija',
      repertoires: [{ id: taimanov, name: 'Taimanovas', side: 'black' }],
    });
    expect(await outcomeOf(coachPlayerData(gabija.id))).toHaveProperty(
      'repertoires.length',
      1,
    );
  });
});
