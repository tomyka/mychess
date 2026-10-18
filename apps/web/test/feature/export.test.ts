import { ecoName, moveKey, START_KEY } from '@mychess/chess';
import { exportAccount, loadRepertoire, setPersonalNote } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GET } from '../../src/app/api/account/export/route';
import { SESSION_NOT_FRESH } from '../../src/lib/sign-in-errors';
import { actAs, person } from './support/coaching';
import { signIn, useRequestHarness } from './support/harness';
import {
  ecoOf,
  LONDON,
  seedRepertoire,
  UNTITLED_TAIMANOV,
} from './support/repertoires';
import { request } from './support/request';

const E4 = moveKey(START_KEY, 'e4');

// The parts of the export the repertoire test reads.
const ExportedSchema = z.object({
  repertoires: z.array(
    z.object({ name: z.string(), side: z.string(), pgn: z.string() }),
  ),
  personalNotes: z.array(
    z.object({ repertoire: z.string(), san: z.string(), text: z.string() }),
  ),
});

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { db, client, sql } = useRequestHarness();

describe('the data export (R-40)', () => {
  it('answers 401 without a session', async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it("downloads the signed-in account's own data only (security item 9)", async () => {
    await signIn('jonas@example.lt');
    request.cookie = await signIn('ruta@example.lt');
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
          await exportAccount(
            db,
            await sql.accountId('ruta@example.lt'),
            new Date(),
          ),
        ),
      ),
    );
    expect(body).toMatchObject({ account: { email: 'ruta@example.lt' } });
  });

  it('lists the requester’s active session, never its token (R-89)', async () => {
    request.cookie = await signIn('ruta@example.lt');
    const token = /session_token=([^.;]+)/.exec(request.cookie)?.[1] ?? '';
    expect(token).not.toBe('');
    const response = await GET();
    const text = await response.text();
    expect(text).not.toContain(token);
    // Exactly these fields: strict, so a token field would fail the parse.
    const { sessions } = z
      .object({
        sessions: z.array(
          z.strictObject({
            ipAddress: z.string().nullable(),
            userAgent: z.string().nullable(),
            createdAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
          }),
        ),
      })
      .parse(JSON.parse(text));
    expect(sessions).toHaveLength(1);
    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'ipAddress',
      'userAgent',
    ]);
  });

  // A stolen old session cannot take the data away (R-95, as R-84 for links).
  it('refuses a session signed in more than a day ago: 403, no data', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await client.query(
      "update sessions set created_at = now() - interval '25 hours'",
    );
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.json()).toStrictEqual({ code: SESSION_NOT_FRESH });
  });

  it('downloads for a session signed in less than a day ago', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await client.query(
      "update sessions set created_at = now() - interval '23 hours'",
    );
    expect((await GET()).status).toBe(200);
  });

  it('holds the requester’s repertoires as PGN and personal notes only, titled in the account’s language (R-40, R-21, decision 21)', async () => {
    const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
    const rimantas = await person(sql, 'rimantas@example.lt', 'Rimantas');
    const mine = await seedRepertoire(db, 'rokas@example.lt', {
      pgn: UNTITLED_TAIMANOV,
      side: 'black',
      name: 'Taimanovas',
    });
    const theirs = await seedRepertoire(db, 'rimantas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Londono sistema',
    });
    const note = (playerId: string, repertoireId: string, text: string) =>
      setPersonalNote(db, {
        playerId,
        repertoireId,
        moveKey: E4,
        text,
        now: new Date(),
      });
    await note(rokas.id, mine, 'Mano planas');
    await note(rimantas.id, theirs, 'Ne Roko');
    const eco = ecoOf(
      (await loadRepertoire(db, mine, rokas.id))?.graph.chapters[0]?.nameSource,
    );

    actAs(rokas);
    const body = ExportedSchema.parse(await (await GET()).json());
    expect(body.repertoires.map((r) => [r.name, r.side])).toEqual([
      ['Taimanovas', 'black'],
    ]);
    expect(body.repertoires[0]?.pgn).toContain(
      `[Event "${ecoName(eco, 'lt')}"]`,
    );
    expect(body.personalNotes).toEqual([
      expect.objectContaining({
        repertoire: 'Taimanovas',
        san: 'e4',
        text: 'Mano planas',
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('Ne Roko');
    expect(JSON.stringify(body)).not.toContain('Londono sistema');

    await client.query(
      "update accounts set locale = 'en' where email = 'rokas@example.lt'",
    );
    const english = ExportedSchema.parse(await (await GET()).json());
    expect(english.repertoires[0]?.pgn).toContain(
      `[Event "${ecoName(eco, 'en')}"]`,
    );
  });

  it('answers 401 for a disabled account', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await client.query('update accounts set disabled_at = now()');
    expect((await GET()).status).toBe(401);
  });
});
