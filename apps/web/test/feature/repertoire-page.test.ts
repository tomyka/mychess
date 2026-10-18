import { moveKey, START_KEY } from '@mychess/chess';
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import RepertoirePage from '../../src/app/repertuarai/[id]/page';
import {
  deleteRepertoireAction,
  renameRepertoireAction,
  savePersonalNoteAction,
} from '../../src/app/repertuarai/[id]/actions';
import { ecoNamesOf } from '../../src/server/chapter-names';
import { repertoirePageData } from '../../src/server/repertoires';
import { actAs, formOf, person, type Person } from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, request, testDb } from './support/request';
import { LONDON, seedRepertoire } from './support/repertoires';

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

const D4 = moveKey(START_KEY, 'd4');

interface Cast {
  readonly rokas: Person;
  readonly gabija: Person;
  /** Rokas's London. */
  readonly london: string;
}

async function cast(): Promise<Cast> {
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  return { rokas, gabija, london };
}

const notes = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as player, n.move_key as "moveKey", n.text
       from personal_notes n join accounts a on a.id = n.player_account_id
      order by 1, 2`,
  );

const names = (): Promise<unknown[]> =>
  sql.rows('select name, version from repertoires order by name');

/** What Next passes the page for a repertoire's path without a query. */
const pageProps = (id: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});

describe('the repertoire page', () => {
  it('renders for the owner with the graph and notes', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const page = await RepertoirePage(pageProps(london));
    expect(isValidElement(page)).toBe(true);
    const data = await repertoirePageData(london);
    expect(data.repertoire).toMatchObject({
      id: london,
      name: 'Londono sistema',
      version: 1,
    });
    expect(data.graph.chapters).toHaveLength(2);
    expect(data.notes).toEqual({});
    expect(data.ecoNames).toEqual(ecoNamesOf(data.graph, 'lt'));
  });

  it('is not found for another account’s repertoire and a malformed id', async () => {
    const { gabija, london } = await cast();
    actAs(gabija);
    expect(await outcomeOf(RepertoirePage(pageProps(london)))).toEqual({
      notFound: true,
    });
    expect(await outcomeOf(RepertoirePage(pageProps('not-a-uuid')))).toEqual({
      notFound: true,
    });
  });

  it('sends a signed-out visitor to sign-in', async () => {
    const { london } = await cast();
    request.cookie = '';
    expect(await outcomeOf(RepertoirePage(pageProps(london)))).toEqual({
      redirectedTo: '/prisijungti',
    });
  });
});

describe('savePersonalNoteAction (R-21)', () => {
  it('stores, replaces and with an empty text deletes the owner’s note', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const save = (text: string) =>
      savePersonalNoteAction({ repertoireId: london, moveKey: D4, text });
    expect(await save('  Mano planas\nsu h3 ')).toEqual({ ok: true });
    expect(await notes()).toEqual([
      { player: 'Rokas', moveKey: D4, text: 'Mano planas\nsu h3' },
    ]);
    expect((await repertoirePageData(london)).notes).toEqual({
      [D4]: 'Mano planas\nsu h3',
    });
    expect(await save('')).toEqual({ ok: true });
    expect(await notes()).toEqual([]);
  });

  it('refuses a note of 2,001 characters', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await savePersonalNoteAction({
        repertoireId: london,
        moveKey: D4,
        text: 'x'.repeat(2001),
      }),
    ).toEqual({ ok: false, refusal: 'personalNote.tooLong' });
    expect(await notes()).toEqual([]);
  });

  it('refuses another account’s repertoire and a malformed request without writing', async () => {
    const { gabija, london } = await cast();
    actAs(gabija);
    expect(
      await savePersonalNoteAction({
        repertoireId: london,
        moveKey: D4,
        text: 'Mano',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    expect(
      await savePersonalNoteAction({
        repertoireId: 'x',
        moveKey: D4,
        text: 'Mano',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    expect(await savePersonalNoteAction(null)).toEqual({
      ok: false,
      refusal: 'repertoire.notFound',
    });
    expect(await notes()).toEqual([]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    const { london } = await cast();
    request.cookie = '';
    expect(
      await outcomeOf(
        savePersonalNoteAction({
          repertoireId: london,
          moveKey: D4,
          text: 'a',
        }),
      ),
    ).toEqual({ redirectedTo: '/prisijungti' });
  });
});

describe('renameRepertoireAction', () => {
  it('renames the owner’s repertoire without a version bump (decision 10)', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await outcomeOf(
        renameRepertoireAction(
          {},
          formOf({ repertoireId: london, name: ' Londonas ' }),
        ),
      ),
    ).toEqual({ saved: true });
    expect(await names()).toEqual([{ name: 'Londonas', version: 1 }]);
    expect(request.refreshed).toBe(1);
  });

  it('refuses a blank name and another account’s repertoire', async () => {
    const { rokas, gabija, london } = await cast();
    actAs(rokas);
    expect(
      await renameRepertoireAction(
        {},
        formOf({ repertoireId: london, name: ' ' }),
      ),
    ).toEqual({ refusal: 'repertoire.nameBlank' });
    actAs(gabija);
    expect(
      await renameRepertoireAction(
        {},
        formOf({ repertoireId: london, name: 'Mano' }),
      ),
    ).toEqual({ refusal: 'repertoire.notFound' });
    expect(
      await renameRepertoireAction(
        {},
        formOf({ repertoireId: 'x', name: 'Mano' }),
      ),
    ).toEqual({ refusal: 'repertoire.notFound' });
    expect(await names()).toEqual([{ name: 'Londono sistema', version: 1 }]);
  });
});

describe('deleteRepertoireAction', () => {
  it('deletes the owner’s repertoire with its notes and goes to the list', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    await savePersonalNoteAction({
      repertoireId: london,
      moveKey: D4,
      text: 'a',
    });
    expect(
      await outcomeOf(
        deleteRepertoireAction({}, formOf({ repertoireId: london })),
      ),
    ).toEqual({ redirectedTo: '/repertuarai?deleted=1' });
    expect(await names()).toEqual([]);
    expect(await notes()).toEqual([]);
    expect(await sql.count('repertoire_moves')).toBe(0);
  });

  it('refuses another account’s repertoire and deletes nothing', async () => {
    const { gabija, london } = await cast();
    actAs(gabija);
    expect(
      await outcomeOf(
        deleteRepertoireAction({}, formOf({ repertoireId: london })),
      ),
    ).toEqual({ refusal: 'repertoire.notFound' });
    expect(await outcomeOf(deleteRepertoireAction({}, new FormData()))).toEqual(
      {
        refusal: 'repertoire.notFound',
      },
    );
    expect(await names()).toEqual([{ name: 'Londono sistema', version: 1 }]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    const { london } = await cast();
    request.cookie = '';
    expect(
      await outcomeOf(
        deleteRepertoireAction({}, formOf({ repertoireId: london })),
      ),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(await names()).toEqual([{ name: 'Londono sistema', version: 1 }]);
  });
});
