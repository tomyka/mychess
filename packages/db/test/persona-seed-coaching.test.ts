// The persona seed's accounts, group, links, assignments, notes and shares
// (docs/personas, #258). Split from persona-seed.test.ts (#366).
import { describe, expect, it } from 'vitest';
import {
  coachAccessFacts,
  coachGroup,
  coachGroups,
  coachInvites,
  listPersonalNotes,
  playerAssignments,
  playerCoaches,
} from '../src';
import { accounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { seedPersonas } from '../src/testing/personas/seed';
import { NOW, SLOW, idOfRepertoire, persona } from './support/persona-seed';

const { db } = useTestDatabase();

describe('seedPersonas', () => {
  it(
    'makes accounts the persona sign-in finds: verified, onboarded',
    async () => {
      await seedPersonas(db, NOW);
      const rows = await db
        .select({
          email: accounts.email,
          displayName: accounts.displayName,
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
          r.emailVerified,
          r.onboarded !== null,
          r.coachSince !== null,
        ]),
      ).toEqual([
        [
          'persona-1400-2000@mychess.test',
          'Gabija Navickaitė',
          true,
          true,
          false,
        ],
        [
          'persona-2000plus@mychess.test',
          'Dovydas Jankauskas',
          true,
          true,
          true,
        ],
        ['persona-coach2@mychess.test', 'Aistė Markevičienė', true, true, true],
        ['persona-coach@mychess.test', 'Rimantas Vaitkus', true, true, true],
        ['persona-u1400@mychess.test', 'Rokas Petrauskas', true, true, false],
      ]);
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
      // The dashboard lists open invites only (#329).
      const open = await coachInvites(db, coach.id, NOW);
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
      const london = await idOfRepertoire(db, rokas.id, 'Londono sistema');
      const rokasFacts = await coachAccessFacts(db, coach.id, rokas.id);
      expect(rokasFacts.linked).toBe(true);
      expect(rokasFacts.sharedRepertoireIds.has(london)).toBe(false);
      expect(rokasFacts.sharedRepertoireIds.size).toBe(0);
      const taimanov = await idOfRepertoire(
        db,
        gabija.id,
        'Sicilijos gynyba, Taimanovo variantas',
      );
      expect(
        (await coachAccessFacts(db, coach.id, gabija.id)).sharedRepertoireIds,
      ).toEqual(new Set([taimanov]));
      const fork = await idOfRepertoire(db, dovydas.id, 'Naidorfo variantas');
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
});
