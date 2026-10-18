import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRepertoireAction } from '../../src/app/repertuarai/actions';
import { myRepertoires } from '../../src/server/repertoires';
import { actAs, formOf, person } from './support/coaching';
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

const repertoireRows = (): Promise<unknown[]> =>
  sql.rows(
    `select a.display_name as owner, r.name, r.side, r.version,
            (select count(*)::int from chapters c where c.repertoire_id = r.id) as chapters
       from repertoires r join accounts a on a.id = r.owner_account_id
      order by 1, 2`,
  );

describe('createRepertoireAction', () => {
  it('makes an empty repertoire and opens it', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    const outcome = await outcomeOf(
      createRepertoireAction(
        {},
        formOf({ name: ' Londono sistema ', side: 'white' }),
      ),
    );
    const ids = (await sql.rows('select id from repertoires')).map(
      (row) => z.object({ id: z.uuid() }).parse(row).id,
    );
    expect(ids).toHaveLength(1);
    expect(outcome).toEqual({ redirectedTo: `/repertuarai/${ids.join('')}` });
    expect(await repertoireRows()).toEqual([
      {
        owner: 'Rokas',
        name: 'Londono sistema',
        side: 'white',
        version: 1,
        chapters: 0,
      },
    ]);
  });

  it('refuses a blank name and makes nothing', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    expect(
      await outcomeOf(
        createRepertoireAction({}, formOf({ name: '  ', side: 'white' })),
      ),
    ).toEqual({ refusal: 'repertoire.nameBlank' });
    expect(
      await outcomeOf(
        createRepertoireAction({}, formOf({ name: 'Londonas', side: 'red' })),
      ),
    ).toEqual({ refusal: 'repertoire.sideInvalid' });
    expect(await repertoireRows()).toEqual([]);
  });

  it('sends a signed-out visitor to sign-in and makes nothing', async () => {
    expect(
      await outcomeOf(
        createRepertoireAction(
          {},
          formOf({ name: 'Londono sistema', side: 'white' }),
        ),
      ),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(await repertoireRows()).toEqual([]);
  });
});

describe('myRepertoires', () => {
  it('lists only the account’s own repertoires, with their counts', async () => {
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    await person(sql, 'gabija@example.lt', 'Gabija');
    await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Londono sistema',
    });
    await seedRepertoire(testDb(), 'gabija@example.lt', {
      pgn: TAIMANOV,
      side: 'black',
      name: 'Taimanovas',
    });
    actAs(rokas);
    expect(
      (await myRepertoires()).map(({ name, side, chapters, moves }) => ({
        name,
        side,
        chapters,
        moves,
      })),
    ).toEqual([
      { name: 'Londono sistema', side: 'white', chapters: 2, moves: 15 },
    ]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(await outcomeOf(myRepertoires())).toEqual({
      redirectedTo: '/prisijungti',
    });
  });
});
