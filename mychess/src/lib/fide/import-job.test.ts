// mychess/src/lib/fide/import-job.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The download is faked (the XML is handed straight to the real stream parser,
// so parsing/ranking is exercised for real) and Supabase is replaced with a
// hand-rolled fake that records what the job actually wrote. `runFideImport`
// takes its URL/key as plain arguments, so no env stubbing is needed.
const mocks = vi.hoisted(() => ({
  streamPlayersList: vi.fn(),
  createClient: vi.fn()
}));

vi.mock('./download', () => ({ streamPlayersList: mocks.streamPlayersList }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));

import { runFideImport } from './import-job';

type Row = Record<string, unknown>;

/** Minimal stand-in for the two tables `runFideImport` touches. */
function makeFakeSupabase() {
  const logInserts: Row[] = [];
  const logUpdates: Row[] = [];
  const upsertedRows: Row[] = [];

  const client = {
    from(table: string) {
      if (table === 'fide_import_logs') {
        return {
          insert(row: Row) {
            logInserts.push(row);
            return {
              select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) })
            };
          },
          update(patch: Row) {
            logUpdates.push(patch);
            return { eq: async () => ({ error: null }) };
          }
        };
      }
      if (table === 'fide_players') {
        return {
          upsert: async (rows: Row[]) => {
            upsertedRows.push(...rows);
            return { error: null };
          }
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }
  };

  return { client, logInserts, logUpdates, upsertedRows };
}

/**
 * Builds a players list with `fillerCount` non-Lithuanian players (to reach —
 * or deliberately fall short of — the plausibility floor) plus the given LTU
 * players.
 */
function buildXml(fillerCount: number, ltu: string[]): string {
  const parts: string[] = ['<playerslist>'];
  for (let i = 1; i <= fillerCount; i++) {
    parts.push(
      `<player><fideid>${1_000_000 + i}</fideid><name>Filler ${i}</name>` +
        `<country>USA</country><rating>1500</rating></player>`
    );
  }
  parts.push(...ltu, '</playerslist>');
  return parts.join('');
}

function ltuPlayer(id: number, name: string, rating: number, birthYear: number): string {
  return (
    `<player><fideid>${id}</fideid><name>${name}</name><country>LTU</country>` +
    `<sex>M</sex><birthday>${birthYear}</birthday><rating>${rating}</rating></player>`
  );
}

/** Feeds `xml` to the job's parser in small pieces, like the real unzip stream. */
function streamXml(xml: string, pieces = 7) {
  return async (onChunk: (chunk: Uint8Array, final: boolean) => void) => {
    const bytes = new TextEncoder().encode(xml);
    const size = Math.ceil(bytes.length / pieces);
    for (let i = 0; i < bytes.length; i += size) {
      onChunk(bytes.subarray(i, i + size), i + size >= bytes.length);
    }
  };
}

describe('runFideImport', () => {
  let db: ReturnType<typeof makeFakeSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeFakeSupabase();
    mocks.createClient.mockReturnValue(db.client);
  });

  it('imports and ranks when the parsed list is a plausible size', async () => {
    const xml = buildXml(100_000, [
      ltuPlayer(4000001, 'Best LTU', 2400, 2010),
      ltuPlayer(4000002, 'Second LTU', 2200, 1970),
      ltuPlayer(4000003, 'Third LTU', 2000, 2010)
    ]);
    mocks.streamPlayersList.mockImplementation(streamXml(xml));

    const result = await runFideImport('https://example.supabase.co', 'service-key', new Date('2026-08-14T00:00:00Z'));

    expect(result.total).toBe(100_003);
    expect(result.ltu).toBe(3);
    expect(result.imported).toBe(3);
    expect(result.errors).toEqual([]);
    expect(db.upsertedRows.map((r) => [r.fide_id, r.country_rank_standard])).toEqual([
      ['4000001', 1],
      ['4000002', 2],
      ['4000003', 3]
    ]);
    expect(db.logUpdates).toHaveLength(1);
    expect(db.logUpdates[0]).toMatchObject({ status: 'success', players_imported: 3 });
  });

  it('logs an error and writes no ranks when the parsed list is implausibly small', async () => {
    // A truncated stream that still produced *some* players: five Lithuanians
    // would otherwise be ranked 1..5 and upserted as if authoritative.
    const xml = buildXml(20, [
      ltuPlayer(4000001, 'Best LTU', 2400, 2010),
      ltuPlayer(4000002, 'Second LTU', 2200, 1970)
    ]);
    mocks.streamPlayersList.mockImplementation(streamXml(xml));

    await expect(
      runFideImport('https://example.supabase.co', 'service-key', new Date('2026-08-14T00:00:00Z'))
    ).rejects.toThrow(/looks truncated: parsed only 22 players/);

    expect(db.upsertedRows).toEqual([]);
    expect(db.logUpdates).toHaveLength(1);
    expect(db.logUpdates[0].status).toBe('error');
    expect(String(db.logUpdates[0].message)).toMatch(/Refusing to import or recompute ranks/);
    expect(db.logUpdates[0].players_imported).toBeUndefined();
  });

  it('logs an error when the download itself fails, without writing any ranks', async () => {
    mocks.streamPlayersList.mockRejectedValue(new Error('invalid zip data'));

    await expect(
      runFideImport('https://example.supabase.co', 'service-key', new Date('2026-08-14T00:00:00Z'))
    ).rejects.toThrow('invalid zip data');

    expect(db.upsertedRows).toEqual([]);
    expect(db.logUpdates).toHaveLength(1);
    expect(db.logUpdates[0]).toMatchObject({ status: 'error', message: 'invalid zip data' });
  });
});
