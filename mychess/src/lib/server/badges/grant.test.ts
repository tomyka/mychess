import { describe, it, expect, vi } from 'vitest';
import { grantNewBadges } from './grant';


// GitHub issue #221. `badges_earned` has SELECT policies and nothing else, and
// both callers hand `grantNewBadges` the anon-key client carrying the player's
// own JWT — so every write was refused and no badge had ever been awarded in
// production. These pin WHICH client each query goes to, which is the whole bug.
describe('grantNewBadges client routing', () => {
  type Call = { client: string; table: string; op: string };

  /**
   * A Supabase stand-in recording the client each query ran on. Every read the
   * function makes has to resolve to the shape it expects, or it throws long
   * before reaching the writes under test.
   */
  function makeClient(name: string, calls: Call[], rows: Record<string, unknown[]> = {}) {
    const result = (table: string, op: string) => {
      calls.push({ client: name, table, op });
      return { data: rows[table] ?? [], error: null };
    };
    const client: any = {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          not: () => chain,
          single: () => Promise.resolve({ data: (rows[table] ?? [{}])[0] ?? {}, error: null }),
          insert: () => {
            calls.push({ client: name, table, op: 'insert' });
            return Promise.resolve({ data: null, error: null });
          },
          delete: () => {
            const del: any = {
              eq: () => del,
              in: () => del,
              select: () => Promise.resolve(result(table, 'delete')),
              then: (res: any) => Promise.resolve(result(table, 'delete')).then(res)
            };
            return del;
          },
          then: (res: any) => Promise.resolve(result(table, 'select')).then(res)
        };
        return chain;
      }
    };
    return client;
  }

  const READS = {
    profiles: [{ streak_days: 0 }],
    player_stats: [{ total_reviews: 1, total_correct: 1, moves_learned: 1 }],
    sessions: [],
    repertoires: [],
    quests: [],
    badges_earned: []
  };

  it('writes badge rows with the write client, never the request client', async () => {
    const calls: Call[] = [];
    const request = makeClient('request', calls, READS);
    const writeClient = makeClient('service', calls, READS);

    const granted = await grantNewBadges(request, 'p1', {}, [], writeClient);

    // The fixture earns first_move (one review, one correct), so there IS a
    // write to attribute — without this the assertion below would pass on a
    // function that simply never wrote anything.
    expect(granted.length).toBeGreaterThan(0);

    const inserts = calls.filter((c) => c.table === 'badges_earned' && c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].client).toBe('service');
    expect(calls.some((c) => c.client === 'request' && c.op === 'insert')).toBe(false);
  });

  it('still reads through the request client, so reads stay scoped by RLS', async () => {
    const calls: Call[] = [];
    const request = makeClient('request', calls, READS);
    const writeClient = makeClient('service', calls, READS);

    await grantNewBadges(request, 'p1', {}, [], writeClient);

    const reads = calls.filter((c) => c.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.client === 'request')).toBe(true);
  });

  // The quieter half of #221: RLS narrowed the revoking DELETE to zero matching
  // rows, and PostgREST reports no error for a delete that matched nothing, so
  // the failure logged nothing at all. Counting what came back is the only
  // signal it ever gives.
  it('reports a revocation that matched fewer rows than it holds', async () => {
    const calls: Call[] = [];
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });
    try {
      // Holds `first_repertoire_learned` — one of the four REVOCABLE_BADGE_IDS
      // — with no learned repertoires behind it any more, which is exactly the
      // demotion the revoke path exists for.
      const held = { ...READS, badges_earned: [{ badge_id: 'first_repertoire_learned' }] };
      const request = makeClient('request', calls, held);
      // Returns no deleted rows, exactly as an RLS-blocked delete does.
      const writeClient = makeClient('service', calls, { ...held, badges_earned: [] });

      // `repertoiresLearned: 0` is what the empty summaries array already means;
      // stated as an override so the revocation is explicit rather than implied.
      await grantNewBadges(request, 'p1', { repertoiresLearned: 0 }, [], writeClient);

      const deletes = calls.filter((c) => c.table === 'badges_earned' && c.op === 'delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0].client).toBe('service');
      expect(errors.join('\n')).toMatch(/matched fewer rows than expected/);
    } finally {
      spy.mockRestore();
    }
  });
});
