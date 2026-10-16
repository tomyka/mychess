import { exportAccount } from '@mychess/db';
import { useTestDatabase } from '@mychess/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GET } from '../../src/app/api/account/export/route';
import {
  buildTestAuth,
  signInByMagicLink,
  type BuiltAuth,
} from './support/auth';

// What the mocked Next.js request carries, and the auth it is checked against.
const request = vi.hoisted(() => {
  const state: { cookie: string; built?: BuiltAuth } = { cookie: '' };
  return state;
});

function built(): BuiltAuth {
  if (request.built === undefined) throw new Error('no test auth was built');
  return request.built;
}

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: request.cookie })),
}));

vi.mock('../../src/server/db', () => ({ getDb: () => db }));

vi.mock('../../src/server/auth', async (original) => ({
  ...(await original<typeof import('../../src/server/auth')>()),
  getAuth: () => built().auth,
}));

const { db, client } = useTestDatabase();

beforeEach(() => {
  request.built = buildTestAuth(db);
  request.cookie = '';
});

async function accountId(email: string): Promise<string> {
  const { rows } = await client.query(
    'select id from accounts where email = $1',
    [email],
  );
  const [row] = z.array(z.object({ id: z.string() })).parse(rows);
  if (row === undefined) throw new Error(`no account ${email}`);
  return row.id;
}

describe('the data export (R-40)', () => {
  it('answers 401 without a session', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it("downloads the signed-in account's own data only (security item 9)", async () => {
    await signInByMagicLink(built(), 'jonas@example.lt');
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="mychess-export.json"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    const body: unknown = await response.json();
    expect(body).toEqual(
      JSON.parse(
        JSON.stringify(
          await exportAccount(db, await accountId('ruta@example.lt')),
        ),
      ),
    );
    expect(body).toMatchObject({ account: { email: 'ruta@example.lt' } });
  });

  it('answers 401 for a disabled account', async () => {
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
    await client.query('update accounts set disabled_at = now()');
    expect((await GET()).status).toBe(401);
  });
});
