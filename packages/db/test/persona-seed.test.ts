import { personaEmail } from '@mychess/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  coachAccessFacts,
  coachGroup,
  coachGroups,
  coachInvites,
  findAccountByEmail,
  listPersonalNotes,
  listRepertoires,
  playerAssignments,
  playerCoaches,
  reviewsOf,
  type Db,
} from '../src';
import { accounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { PERSONA_ACCOUNTS } from '../src/testing/personas/accounts';
import { runSeedPersonas } from '../src/testing/personas/command';
import { seedPersonas } from '../src/testing/personas/seed';
import { seedPlayer } from './support/coaching';

const { db, client, url } = useTestDatabase();

const NOW = new Date('2026-11-09T08:00:00Z');
/** Seeding replays almost a year of training through recordResults. */
const SLOW = 240_000;

const countsSchema = z.array(z.object({ name: z.string(), n: z.number() }));

/** Every table's row count, by table name. */
async function tableCounts(): Promise<Map<string, number>> {
  const { rows } = await client.query(
    `select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
  );
  const counts = new Map<string, number>();
  for (const { name } of z.array(z.object({ name: z.string() })).parse(rows)) {
    const result = await client.query(
      `select '${name}' as name, count(*)::int as n from "${name}"`,
    );
    for (const row of countsSchema.parse(result.rows))
      counts.set(row.name, row.n);
  }
  return counts;
}

/** The seeded account with this persona email; throws if there is none. */
async function persona(database: Db, email: string) {
  const canonical = personaEmail(email);
  if (!canonical.ok) throw new Error(email);
  const found = await findAccountByEmail(database, canonical.value);
  if (found === undefined) throw new Error(`no account ${email}`);
  return found;
}

const idOfRepertoire = async (ownerId: string, name: string) => {
  const found = (await listRepertoires(db, ownerId)).find(
    (r) => r.name === name,
  );
  if (found === undefined) throw new Error(`no repertoire ${name}`);
  return found.id;
};

describe('seedPersonas', () => {
  it(
    'seeds the same rows when run twice, without duplicates',
    async () => {
      await seedPersonas(db, NOW);
      const first = await tableCounts();
      await seedPersonas(db, NOW);
      expect(await tableCounts()).toEqual(first);
      expect(first.get('accounts')).toBe(PERSONA_ACCOUNTS.length);
      expect(first.get('repertoires')).toBe(16);
      expect(first.get('coach_links')).toBe(4);
      expect(first.get('group_members')).toBe(3);
      expect(first.get('invites')).toBe(5);
      expect(first.get('assignments')).toBe(8);
      expect(first.get('repertoire_shares')).toBe(2);
      expect(first.get('personal_notes')).toBe(2);
    },
    SLOW,
  );

  it(
    'makes accounts the persona sign-in finds: verified, onboarded, in the doc language',
    async () => {
      await seedPersonas(db, NOW);
      const rows = await db
        .select({
          email: accounts.email,
          displayName: accounts.displayName,
          locale: accounts.locale,
          emailVerified: accounts.emailVerified,
          onboarded: accounts.onboardedAt,
          coachSince: accounts.coachSince,
        })
        .from(accounts)
        .orderBy(accounts.email);
      expect(
        rows.map((r) => [
          r.email,
          r.displayName,
          r.locale,
          r.emailVerified,
          r.onboarded !== null,
          r.coachSince !== null,
        ]),
      ).toEqual([
        [
          'persona-1400-2000@mychess.test',
          'Gabija Navickaitė',
          'lt',
          true,
          true,
          false,
        ],
        [
          'persona-2000plus@mychess.test',
          'Dovydas Jankauskas',
          'en',
          true,
          true,
          true,
        ],
        [
          'persona-coach2@mychess.test',
          'Aistė Markevičienė',
          'lt',
          true,
          true,
          true,
        ],
        [
          'persona-coach@mychess.test',
          'Rimantas Vaitkus',
          'lt',
          true,
          true,
          true,
        ],
        [
          'persona-u1400@mychess.test',
          'Rokas Petrauskas',
          'lt',
          true,
          true,
          false,
        ],
      ]);
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

  it(
    "gives the coach's group three members, with their join dates, and a pending invite",
    async () => {
      await seedPersonas(db, NOW);
      const coach = await persona(db, 'persona-coach@mychess.test');
      const [summary, ...others] = await coachGroups(db, coach.id);
      expect(others).toEqual([]);
      expect(summary).toMatchObject({ name: 'Šeštadienio grupė' });
      const group = await coachGroup(db, coach.id, summary?.id ?? '');
      expect(
        group?.members.map((m) => [
          m.displayName,
          m.joinedAt.toISOString().slice(0, 10),
        ]),
      ).toEqual([
        ['Dovydas Jankauskas', '2025-11-20'],
        ['Gabija Navickaitė', '2026-02-01'],
        ['Rokas Petrauskas', '2026-04-12'],
      ]);
      const open = (await coachInvites(db, coach.id, NOW)).filter(
        (i) => i.state === 'active',
      );
      expect(open).toEqual([
        expect.objectContaining({
          kind: 'group',
          groupName: 'Šeštadienio grupė',
        }),
      ]);
    },
    SLOW,
  );

  it(
    'gives Rokas his Italian with its deadline, his other assignments and his note on 4.c3',
    async () => {
      await seedPersonas(db, NOW);
      const rokas = await persona(db, 'persona-u1400@mychess.test');
      const assigned = await playerAssignments(db, rokas.id, NOW);
      expect(assigned.map((a) => [a.name, a.coachName]).sort()).toEqual([
        ['1...e5', 'Rimantas Vaitkus'],
        ['Atmestas valdovės gambitas', 'Rimantas Vaitkus'],
        ['Itališkoji partija', 'Rimantas Vaitkus'],
        ['Karo-Kan gynyba: pagrindai', 'Rimantas Vaitkus'],
      ]);
      const italian = assigned.find((a) => a.name === 'Itališkoji partija');
      expect(italian?.deadline).toBe('2026-11-30');
      const notes = await listPersonalNotes(
        db,
        rokas.id,
        italian?.repertoireId ?? '',
      );
      expect(Object.values(notes)).toEqual(['Nepamiršti d3 prieš d4']);
    },
    SLOW,
  );

  it(
    "keeps Rokas's London private and shares Gabija's Taimanov and Dovydas's fork (Q26)",
    async () => {
      await seedPersonas(db, NOW);
      const coach = await persona(db, 'persona-coach@mychess.test');
      const rokas = await persona(db, 'persona-u1400@mychess.test');
      const gabija = await persona(db, 'persona-1400-2000@mychess.test');
      const dovydas = await persona(db, 'persona-2000plus@mychess.test');
      const london = await idOfRepertoire(rokas.id, 'Londono sistema');
      const rokasFacts = await coachAccessFacts(db, coach.id, rokas.id);
      expect(rokasFacts.linked).toBe(true);
      expect(rokasFacts.sharedRepertoireIds.has(london)).toBe(false);
      expect(rokasFacts.sharedRepertoireIds.size).toBe(0);
      const taimanov = await idOfRepertoire(
        gabija.id,
        'Sicilijos gynyba, Taimanovo variantas',
      );
      expect(
        (await coachAccessFacts(db, coach.id, gabija.id)).sharedRepertoireIds,
      ).toEqual(new Set([taimanov]));
      const fork = await idOfRepertoire(dovydas.id, 'Naidorfo variantas');
      expect(
        (await coachAccessFacts(db, coach.id, dovydas.id)).sharedRepertoireIds,
      ).toEqual(new Set([fork]));
    },
    SLOW,
  );

  it(
    'gives Gabija two coaches, the second with no assignments',
    async () => {
      await seedPersonas(db, NOW);
      const gabija = await persona(db, 'persona-1400-2000@mychess.test');
      expect(
        (await playerCoaches(db, gabija.id)).map((c) => c.displayName),
      ).toEqual(['Aistė Markevičienė', 'Rimantas Vaitkus']);
      const assigned = await playerAssignments(db, gabija.id, NOW);
      expect(new Set(assigned.map((a) => a.coachName))).toEqual(
        new Set(['Rimantas Vaitkus']),
      );
      expect(
        assigned.find((a) => a.name === 'Valdovės gambitas')?.deadline,
      ).toBe('2026-12-15');
      expect(assigned.find((a) => a.name === 'Slavų gynyba')?.deadline).toBe(
        '2026-11-30',
      );
    },
    SLOW,
  );

  it(
    "gives Dovydas his fork with the coach's chapters and his own five",
    async () => {
      await seedPersonas(db, NOW);
      const dovydas = await persona(db, 'persona-2000plus@mychess.test');
      const owned = await listRepertoires(db, dovydas.id);
      expect(owned.map((r) => [r.name, r.chapters]).sort()).toEqual([
        ['Katalonų pradžia', 5],
        ['Katalonų pradžia: 8.a4 sistema', 1],
        ['Naidorfo variantas', 8],
        ['Naidorfo variantas: 6.Be3 Ng4', 1],
        ['Nimcovičiaus gynyba ir Damų indų gynyba', 8],
      ]);
    },
    SLOW,
  );

  it(
    'writes the training history through the app, with its lapses, and reports what is due',
    async () => {
      const summary = await seedPersonas(db, NOW);
      const reviewsOfPersona = async (email: string) => [
        ...(await reviewsOf(db, (await persona(db, email)).id)).values(),
      ];
      const lapsed = (reviews: Awaited<ReturnType<typeof reviewsOfPersona>>) =>
        reviews.map((r) => r.review.lapses.length).filter((n) => n > 0);
      const rokas = await reviewsOfPersona('persona-u1400@mychess.test');
      expect(rokas.length).toBeGreaterThan(20);
      expect(lapsed(rokas)).toEqual([2, 2]);
      expect(
        rokas.every((r) => r.learnedAt !== null && r.learnedAt < NOW),
      ).toBe(true);
      expect(
        lapsed(await reviewsOfPersona('persona-1400-2000@mychess.test')),
      ).toEqual([4]);
      expect(
        lapsed(await reviewsOfPersona('persona-2000plus@mychess.test')),
      ).toEqual([3]);
      expect(
        (await reviewsOfPersona('persona-coach2@mychess.test')).length,
      ).toBe(0);
      for (const { email } of PERSONA_ACCOUNTS) {
        const due = (await reviewsOfPersona(email)).filter(
          (r) => r.review.fsrs.due <= NOW,
        ).length;
        expect(summary.due[email]).toBe(due);
      }
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
    expect((await tableCounts()).get('accounts')).toBe(0);
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
      expect((await tableCounts()).get('accounts')).toBe(5);
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
