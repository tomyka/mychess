// The repertoire page's actions when the repertoire is deleted between the
// action's access check and its write: the write's own check refuses it,
// and the action passes the refusal on.
import { deleteRepertoire } from '@mychess/db';
import { moveKey, START_KEY } from '@mychess/chess';
import { describe, expect, it, vi } from 'vitest';
import {
  deleteRepertoireAction,
  renameRepertoireAction,
  savePersonalNoteAction,
} from '../../src/app/repertuarai/[id]/actions';
import type * as Repertoires from '../../src/server/repertoires';
import { actAs, formOf, person } from './support/coaching';
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
// Access is granted, then the repertoire is deleted before the write.
vi.mock('../../src/server/repertoires', async (importOriginal) => {
  const original = await importOriginal<typeof Repertoires>();
  return {
    ...original,
    ownRepertoire: async (
      ...args: Parameters<typeof original.ownRepertoire>
    ) => {
      const own = await original.ownRepertoire(...args);
      if (own.ok)
        await deleteRepertoire(
          testDb(),
          own.value.repertoire.id,
          own.value.repertoire.ownerId,
          new Date(),
        );
      return own;
    },
  };
});

const { sql } = useRequestHarness();

describe('savePersonalNoteAction, repertoire deleted mid-request', () => {
  it('passes on the write’s refusal and stores no note', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Londono sistema',
    });
    expect(
      await savePersonalNoteAction({
        repertoireId: london,
        moveKey: moveKey(START_KEY, 'd4'),
        text: 'Mano planas',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    expect(await sql.count('personal_notes')).toBe(0);
  });
});

describe('renameRepertoireAction and deleteRepertoireAction, repertoire deleted mid-request', () => {
  it('passes on the write’s refusal: no rename, no refresh, no redirect', async () => {
    actAs(await person(sql, 'rokas@example.lt', 'Rokas'));
    const seed = () =>
      seedRepertoire(testDb(), 'rokas@example.lt', {
        pgn: LONDON,
        side: 'white',
        name: 'Londono sistema',
      });
    const renamed = await seed();
    expect(
      await outcomeOf(
        renameRepertoireAction(
          {},
          formOf({ repertoireId: renamed, name: 'Londonas' }),
        ),
      ),
    ).toEqual({ refusal: 'repertoire.notFound' });
    expect(request.refreshed).toBe(0);
    const deleted = await seed();
    expect(
      await outcomeOf(
        deleteRepertoireAction({}, formOf({ repertoireId: deleted })),
      ),
    ).toEqual({ refusal: 'repertoire.notFound' });
    expect(await sql.count('repertoires')).toBe(0);
  });
});
