// The persona seed's repertoires and training: Dovydas's fork, the training
// history, and the two repertoires imported from their PGN files with
// comments, NAGs and long notes (#332). Split from persona-seed.test.ts
// (#366).
import { moveKey } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  listPersonalNotes,
  listRepertoires,
  loadRepertoire,
  reviewsOf,
} from '../src';
import { useTestDatabase } from '../src/testing';
import { PERSONA_ACCOUNTS } from '../src/testing/personas/accounts';
import { seedPersonas } from '../src/testing/personas/seed';
import { NOW, SLOW, idOfRepertoire, persona } from './support/persona-seed';

const { db } = useTestDatabase();

describe('seedPersonas', () => {
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

describe('seedPersonas imports (#332)', () => {
  it(
    "imports Gabija's Taimanov from her PGN file, with its comments and variations (G-M1-3)",
    async () => {
      await seedPersonas(db, NOW);
      const gabija = await persona(db, 'persona-1400-2000@mychess.test');
      const id = await idOfRepertoire(
        db,
        gabija.id,
        'Sicilijos gynyba, Taimanovo variantas',
      );
      const graph = (await loadRepertoire(db, id, gabija.id))?.graph;
      const comments = graph?.moves.flatMap((m) =>
        m.comment === null ? [] : [[m.san, m.comment]],
      );
      // persona-taimanov.pgn (packages/chess/src/pgn/fixtures) has 9 move comments and 2 intros.
      expect(comments).toHaveLength(9);
      expect(comments).toContainEqual(['Bb4', 'jei 9.Na4, tai Be7']);
      expect(graph?.chapters.filter((c) => c.intro !== null)).toHaveLength(2);
      // The 7.Qf3 sideline the doc's fence leaves out.
      expect(graph?.moves.map((m) => m.san)).toContain('Qf3');
    },
    SLOW,
  );

  it(
    "imports Dovydas's Catalan from his PGN file, with its comments and NAGs (D-M1-2)",
    async () => {
      await seedPersonas(db, NOW);
      const dovydas = await persona(db, 'persona-2000plus@mychess.test');
      const id = await idOfRepertoire(db, dovydas.id, 'Katalonų pradžia');
      const graph = (await loadRepertoire(db, id, dovydas.id))?.graph;
      const commented = graph?.moves.filter((m) => m.comment !== null);
      // persona-katalonu.pgn (packages/chess/src/pgn/fixtures) has 7 move comments.
      expect(commented).toHaveLength(7);
      expect(new Set(graph?.moves.flatMap((m) => m.nags))).toEqual(
        new Set([1, 14]),
      );
      expect(
        graph?.moves.find((m) => m.san === 'Qxc4' && m.nags.includes(1)),
      ).toBeDefined();
    },
    SLOW,
  );

  it(
    'gives Dovydas his long notes on 12.g5 and 17.Rb3 in his Najdorf fork (D-M8 layout)',
    async () => {
      await seedPersonas(db, NOW);
      const dovydas = await persona(db, 'persona-2000plus@mychess.test');
      const fork = await idOfRepertoire(db, dovydas.id, 'Naidorfo variantas');
      const graph = (await loadRepertoire(db, fork, dovydas.id))?.graph;
      const notes = await listPersonalNotes(db, dovydas.id, fork);
      const sanOf = (key: string) =>
        graph?.moves.find((m) => moveKey(m.from, m.san) === key)?.san;
      const long = Object.entries(notes).map(([key, text]) => [
        sanOf(key),
        text.length >= 300,
      ]);
      expect(long.sort()).toEqual([
        ['Rb3', true],
        ['g5', true],
      ]);
    },
    SLOW,
  );
});
