import {
  ecoName,
  importPgn,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { loadRepertoire } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../src/app/api/repertoires/[id]/export/route';
import { contentDisposition } from '../../src/server/pgn-download';
import { actAs, person, type Person } from './support/coaching';
import { useRequestHarness } from './support/harness';
import { request, testDb } from './support/request';
import {
  ecoOf,
  LONDON,
  seedRepertoire,
  UNTITLED_TAIMANOV,
} from './support/repertoires';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { client, sql } = useRequestHarness();

interface Cast {
  readonly rokas: Person;
  readonly rimantas: Person;
  /** Rokas's Taimanov. */
  readonly taimanov: string;
}

async function cast(): Promise<Cast> {
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const rimantas = await person(sql, 'rimantas@example.lt', 'Rimantas');
  const taimanov = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: UNTITLED_TAIMANOV,
    side: 'black',
    name: 'Sicilijos gynyba, Taimanovo variantas',
  });
  return { rokas, rimantas, taimanov };
}

const download = (id: string): Promise<Response> =>
  GET(new Request(`http://localhost/api/repertoires/${id}/export`), {
    params: Promise.resolve({ id }),
  });

// The tree as the export round trip must keep it (export-pgn.test.ts).
const canonical = (graph: RepertoireGraph): string[] => {
  const ids = graph.chapters.map((c) => c.id);
  return graph.moves
    .map((m) =>
      JSON.stringify([
        m.from,
        m.san,
        m.arrows,
        m.circles,
        m.comment,
        m.chapters.map((c) => ids.indexOf(c)).sort(),
      ]),
    )
    .sort();
};

async function storedGraph(
  id: string,
  ownerId: string,
): Promise<RepertoireGraph> {
  const loaded = await loadRepertoire(testDb(), id, ownerId);
  if (loaded === undefined) throw new Error('no repertoire');
  return loaded.graph;
}

/** The downloaded body imported again, as `canonical`; nothing may be skipped. */
async function reimported(response: Response, side: Side): Promise<string[]> {
  const again = importPgn(await response.text(), side);
  if (!again.ok) throw new Error(again.refusal.reason);
  expect(again.value.skipped).toEqual([]);
  return canonical(again.value.graph);
}

describe('the PGN download (R-96, decision 13)', () => {
  it('answers 401 without a session, cached nowhere', async () => {
    const { taimanov } = await cast();
    request.cookie = '';
    const response = await download(taimanov);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('answers the same 404 for another account’s, a missing and a malformed id', async () => {
    const { rimantas, taimanov } = await cast();
    actAs(rimantas);
    for (const id of [taimanov, crypto.randomUUID(), 'not-a-uuid']) {
      const response = await download(id);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(await response.text()).toBe('');
    }
  });

  it('downloads the owner’s repertoire as PGN that re-imports to the stored tree (G-M1-6)', async () => {
    const { rokas, taimanov } = await cast();
    actAs(rokas);
    const response = await download(taimanov);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe(
      'application/x-chess-pgn; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      contentDisposition('Sicilijos gynyba, Taimanovo variantas'),
    );
    const stored = await storedGraph(taimanov, rokas.id);
    expect(await reimported(response, 'black')).toEqual(canonical(stored));
    expect(canonical(stored).join()).toContain('The main line');
  });

  it('keeps arrows, comments and shared chapters through the round trip', async () => {
    const { rokas } = await cast();
    const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Londono sistema',
    });
    actAs(rokas);
    const stored = await storedGraph(london, rokas.id);
    expect(stored.moves.some((m) => m.arrows.length > 0)).toBe(true);
    expect(stored.moves.some((m) => m.chapters.length > 1)).toBe(true);
    expect(await reimported(await download(london), 'white')).toEqual(
      canonical(stored),
    );
  });

  it('titles the chapters in the account’s language (decision 14)', async () => {
    const { rokas, taimanov } = await cast();
    actAs(rokas);
    const eco = ecoOf(
      (await storedGraph(taimanov, rokas.id)).chapters[0]?.nameSource,
    );
    const lt = await (await download(taimanov)).text();
    expect(ecoName(eco, 'lt')).toMatch(/^Siciliška gynyba/u);
    expect(lt).toContain(`[Event "${ecoName(eco, 'lt')}"]`);
    await client.query(
      "update accounts set locale = 'en' where email = 'rokas@example.lt'",
    );
    const en = await (await download(taimanov)).text();
    expect(en).toContain(`[Event "${ecoName(eco, 'en')}"]`);
    expect(en).not.toContain(ecoName(eco, 'lt'));
  });

  it('falls back to a safe file name when the name has no letters or digits', async () => {
    const { rokas } = await cast();
    const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: '???',
    });
    actAs(rokas);
    const response = await download(london);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="repertuaras.pgn"; filename*=UTF-8\'\'%3F%3F%3F.pgn',
    );
  });
});
