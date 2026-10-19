// "Share with coach" on the repertoire page (S4 Task B5, R-42, R-107):
// the owner is always the session account, only linked coaches can be
// chosen, and the owner's page shows every coach's notes with names.
import { moveKey, START_KEY } from '@mychess/chess';
import { shareRepertoire, upsertCoachNote } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import { setSharesAction } from '../../src/app/repertuarai/[id]/sharing-actions';
import { repertoirePageData } from '../../src/server/repertoires';
import {
  actAs,
  coachPerson,
  formOf,
  link,
  person,
  type Person,
} from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, request, testDb } from './support/request';
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

interface Cast {
  /** Coach, linked to Gabija and Rokas. */
  readonly rimantas: Person;
  /** Coach, linked to Gabija. */
  readonly dovydas: Person;
  /** Coach, linked to nobody. */
  readonly jonas: Person;
  readonly gabija: Person;
  readonly rokas: Person;
  /** Gabija's Taimanov. */
  readonly taimanov: string;
  /** Rokas's London, shared with Rimantas. */
  readonly london: string;
}

async function cast(): Promise<Cast> {
  const rimantas = await coachPerson(sql, 'rimantas@example.lt', 'Rimantas');
  const dovydas = await coachPerson(sql, 'dovydas@example.lt', 'Dovydas');
  const jonas = await coachPerson(sql, 'jonas@example.lt', 'Jonas');
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
  const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  const shared = await shareRepertoire(testDb(), {
    ownerId: rokas.id,
    repertoireId: london,
    coachId: rimantas.id,
    now: new Date(),
  });
  if (!shared.ok) throw new Error(shared.refusal.reason);
  return { rimantas, dovydas, jonas, gabija, rokas, taimanov, london };
}

/** A share form: the repertoire and the checked coaches. */
function sharesForm(repertoireId: string, coachIds: readonly string[]) {
  const form = formOf({ repertoireId });
  for (const id of coachIds) form.append('coachIds', id);
  return form;
}

/** Every share as repertoire and coach names. */
const shares = (): Promise<unknown[]> =>
  sql.rows(
    `select r.name as repertoire, c.display_name as coach
       from repertoire_shares s
       join repertoires r on r.id = s.repertoire_id
       join accounts c on c.id = s.coach_id
      order by 1, 2`,
  );

describe('setSharesAction (R-42)', () => {
  it('shares with the checked coaches and unshares the unchecked ones', async () => {
    const { rimantas, dovydas, gabija, taimanov } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(taimanov, [rimantas.id]))),
    ).toEqual({ shared: 1 });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
      { repertoire: 'Taimanovas', coach: 'Rimantas' },
    ]);
    expect(
      await outcomeOf(
        setSharesAction({}, sharesForm(taimanov, [rimantas.id, dovydas.id])),
      ),
    ).toEqual({ shared: 2 });
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(taimanov, [dovydas.id]))),
    ).toEqual({ shared: 1 });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
      { repertoire: 'Taimanovas', coach: 'Dovydas' },
    ]);
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(taimanov, []))),
    ).toEqual({ shared: 0 });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
    ]);
  });

  it('never shares with a coach the owner is not linked to', async () => {
    const { rimantas, jonas, gabija, taimanov } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(
        setSharesAction({}, sharesForm(taimanov, [jonas.id, rimantas.id])),
      ),
    ).toEqual({ shared: 1, refusal: 'share.notLinked' });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
      { repertoire: 'Taimanovas', coach: 'Rimantas' },
    ]);
  });

  it('changes nothing on another account’s repertoire (checklist 4)', async () => {
    const { rimantas, gabija, london } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(london, []))),
    ).toEqual({ refusal: 'share.notOwner' });
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(london, [rimantas.id]))),
    ).toEqual({ refusal: 'share.notOwner' });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
    ]);
  });

  it('refuses a malformed request and changes nothing', async () => {
    const { rimantas, gabija, taimanov } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(setSharesAction({}, sharesForm('nėra', [rimantas.id]))),
    ).toEqual({ refusal: 'share.notOwner' });
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(taimanov, ['']))),
    ).toEqual({ refusal: 'share.notLinked' });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
    ]);
  });

  it('sends a signed-out visitor to sign-in and changes nothing', async () => {
    const { rimantas, taimanov } = await cast();
    request.cookie = '';
    expect(
      await outcomeOf(setSharesAction({}, sharesForm(taimanov, [rimantas.id]))),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(await shares()).toEqual([
      { repertoire: 'Londono sistema', coach: 'Rimantas' },
    ]);
  });
});

describe('the owner’s repertoire page with coaches', () => {
  it('lists the linked coaches and which of them it is shared with', async () => {
    const { rimantas, dovydas, gabija, taimanov } = await cast();
    actAs(gabija);
    await outcomeOf(setSharesAction({}, sharesForm(taimanov, [dovydas.id])));
    const data = await repertoirePageData(taimanov);
    expect(data.sharing).toEqual({
      coaches: [
        { id: dovydas.id, displayName: 'Dovydas' },
        { id: rimantas.id, displayName: 'Rimantas' },
      ],
      sharedWith: [dovydas.id],
    });
  });

  it('shows every coach’s notes with their names, until sharing ends (R-107, R-124, R-125)', async () => {
    const { rimantas, dovydas, gabija, taimanov } = await cast();
    actAs(gabija);
    await outcomeOf(
      setSharesAction({}, sharesForm(taimanov, [rimantas.id, dovydas.id])),
    );
    for (const [coach, text] of [
      [rimantas, 'Rimanto pastaba'],
      [dovydas, 'Dovydo pastaba'],
    ] as const) {
      const written = await upsertCoachNote(testDb(), {
        coachId: coach.id,
        playerId: gabija.id,
        repertoireId: taimanov,
        moveKey: E4,
        text,
        now: new Date(),
      });
      expect(written.ok).toBe(true);
    }
    expect((await repertoirePageData(taimanov)).coachNotes).toEqual([
      {
        coachId: dovydas.id,
        coachName: 'Dovydas',
        moveKey: E4,
        text: 'Dovydo pastaba',
      },
      {
        coachId: rimantas.id,
        coachName: 'Rimantas',
        moveKey: E4,
        text: 'Rimanto pastaba',
      },
    ]);
    await outcomeOf(setSharesAction({}, sharesForm(taimanov, [dovydas.id])));
    expect((await repertoirePageData(taimanov)).coachNotes).toEqual([
      {
        coachId: dovydas.id,
        coachName: 'Dovydas',
        moveKey: E4,
        text: 'Dovydo pastaba',
      },
    ]);
  });

  it('has no coaches or notes for a player without a coach', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const data = await repertoirePageData(london);
    expect(data.coachNotes).toEqual([]);
    expect(data.sharing.sharedWith).toHaveLength(1);
  });
});
