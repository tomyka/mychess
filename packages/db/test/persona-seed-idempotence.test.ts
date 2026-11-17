// The persona seed (#258) replaces itself: the same rows twice, a test
// sign-in account replaced, others kept; the due backlog it leaves; and the
// seed:personas command (R-32, R-168). Split from persona-seed.test.ts
// (#366).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findAccountByEmail } from '../src';
import { accounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { PERSONA_ACCOUNTS } from '../src/testing/personas/accounts';
import { runSeedPersonas } from '../src/testing/personas/command';
import { seedPersonas } from '../src/testing/personas/seed';
import { seedPlayer } from './support/coaching';
import { NOW, SLOW, persona, tableCounts } from './support/persona-seed';

const { db, client, url } = useTestDatabase();

describe('seedPersonas', () => {
  it(
    'seeds the same rows when run twice, without duplicates',
    async () => {
      await seedPersonas(db, NOW);
      const first = await tableCounts(client);
      await seedPersonas(db, NOW);
      expect(await tableCounts(client)).toEqual(first);
      expect(first.get('accounts')).toBe(PERSONA_ACCOUNTS.length);
      expect(first.get('repertoires')).toBe(16);
      expect(first.get('coach_links')).toBe(4);
      expect(first.get('group_members')).toBe(3);
      expect(first.get('invites')).toBe(5);
      expect(first.get('assignments')).toBe(8);
      expect(first.get('repertoire_shares')).toBe(2);
      expect(first.get('personal_notes')).toBe(4);
      expect(first.get('coach_notes')).toBe(1);
    },
    SLOW,
  );

  it(
    'replaces a persona account the test sign-in made before, and leaves other accounts alone',
    async () => {
      await seedPlayer(db, 'someone', 'someone@example.lt');
      await db.insert(accounts).values({
        id: 'made-by-test-sign-in',
        email: 'persona-u1400@mychess.test',
        displayName: '',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await seedPersonas(db, NOW);
      const rokas = await persona(db, 'persona-u1400@mychess.test');
      expect(rokas.displayName).toBe('Rokas Petrauskas');
      expect(rokas.id).not.toBe('made-by-test-sign-in');
      expect(await findAccountByEmail(db, 'someone@example.lt')).toMatchObject({
        id: 'someone',
      });
    },
    SLOW,
  );
});

describe('seedPersonas due reviews (M1 journey preconditions)', () => {
  it(
    'leaves reviews due for U1-M1-3 and D-M1-5, and a backlog of 80+ for G-M1-4',
    async () => {
      const { due } = await seedPersonas(db, NOW);
      expect(due['persona-u1400@mychess.test']).toBeGreaterThan(0);
      expect(due['persona-1400-2000@mychess.test']).toBeGreaterThanOrEqual(80);
      expect(due['persona-2000plus@mychess.test']).toBeGreaterThan(0);
    },
    SLOW,
  );
});

describe('runSeedPersonas', () => {
  let out: string[];
  let err: string[];

  const capture = () => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
  };

  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses a non-local environment with exit code 1 and writes nothing', async () => {
    capture();
    await runSeedPersonas(
      { MYCHESS_ENV: 'production', DATABASE_URL: url },
      NOW,
    );
    expect(err).toEqual(['seed:personas: seed.notLocalEnv\n']);
    expect(out).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect((await tableCounts(client)).get('accounts')).toBe(0);
  });

  it('refuses a database that is not local, before connecting', async () => {
    capture();
    await runSeedPersonas(
      {
        MYCHESS_ENV: 'local',
        DATABASE_URL: 'postgres://m:m@postgres:5432/mychess',
      },
      NOW,
    );
    expect(err).toEqual(['seed:personas: seed.notLocalDatabase\n']);
    expect(process.exitCode).toBe(1);
  });

  it(
    'seeds the local database in DATABASE_URL and reports what it made',
    async () => {
      capture();
      await runSeedPersonas({ MYCHESS_ENV: 'local', DATABASE_URL: url }, NOW);
      expect(err).toEqual([]);
      expect(process.exitCode).toBeUndefined();
      expect(out[0]).toBe('seed:personas: 5 accounts, 16 repertoires\n');
      expect(out.slice(1).join('')).toMatch(
        /persona-u1400@mychess\.test: \d+ due/,
      );
      expect((await tableCounts(client)).get('accounts')).toBe(5);
    },
    SLOW,
  );

  it('is the body of the seed:personas script, which refuses the same way', async () => {
    capture();
    vi.stubEnv('MYCHESS_ENV', 'staging');
    vi.stubEnv('DATABASE_URL', url);
    await import('../src/testing/personas/seed-personas');
    expect(err).toEqual(['seed:personas: seed.notLocalEnv\n']);
    expect(process.exitCode).toBe(1);
  });
});
