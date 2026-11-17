// The persona seed's M2 review states: coach notes on due moves and an
// overdue assignment (R-51, R-107, R-174). Split from persona-seed.test.ts
// (#366).
import { moveKey } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  coachNotesOn,
  loadRepertoire,
  playerAssignments,
  reviewsOf,
} from '../src';
import { useTestDatabase } from '../src/testing';
import { seedPersonas } from '../src/testing/personas/seed';
import { NOW, SLOW, idOfRepertoire, persona } from './support/persona-seed';

const { db } = useTestDatabase();

describe('seedPersonas M2 review states', () => {
  /** Is the review of move `key` due for `playerId` at the seed date? */
  const dueAt = async (playerId: string, key: string) => {
    const review = (await reviewsOf(db, playerId)).get(key);
    return review !== undefined && review.review.fsrs.due <= NOW;
  };

  it(
    'puts a coach comment on a Caro-Kann move due for Rokas at the seed date (U1-M2-4, R-174)',
    async () => {
      await seedPersonas(db, NOW);
      const coach = await persona(db, 'persona-coach@mychess.test');
      const rokas = await persona(db, 'persona-u1400@mychess.test');
      const id = await idOfRepertoire(
        db,
        coach.id,
        'Karo-Kan gynyba: pagrindai',
      );
      const graph = (await loadRepertoire(db, id, coach.id))?.graph;
      const commented = graph?.moves.filter((m) => m.comment !== null) ?? [];
      expect(commented.map((m) => m.san)).toEqual(['Qd7']);
      const [qd7] = commented;
      expect(qd7?.comment).toMatch(/^Valdovė d7/);
      expect(await dueAt(rokas.id, moveKey(qd7?.from ?? '', 'Qd7'))).toBe(true);
      // Written before the assignment: no "Updated" badge (R-133).
      const caroKann = (await playerAssignments(db, rokas.id, NOW)).find(
        (a) => a.repertoireId === id,
      );
      expect(caroKann?.badges.updated).toBe(false);
    },
    SLOW,
  );

  it(
    "gives Gabija's shared Taimanov Rimantas's coach note on 9...Be7, due at the seed date (R-107, R-174)",
    async () => {
      await seedPersonas(db, NOW);
      const gabija = await persona(db, 'persona-1400-2000@mychess.test');
      const id = await idOfRepertoire(
        db,
        gabija.id,
        'Sicilijos gynyba, Taimanovo variantas',
      );
      const notes = await coachNotesOn(db, gabija.id, id);
      expect(notes.map((n) => [n.coachName, n.text.slice(0, 22)])).toEqual([
        ['Rimantas Vaitkus', 'Teisingai, 9...Be7, ne'],
      ]);
      const graph = (await loadRepertoire(db, id, gabija.id))?.graph;
      const be7 = graph?.moves.find(
        (m) => moveKey(m.from, m.san) === notes[0]?.moveKey,
      );
      expect(be7?.san).toBe('Be7');
      expect(await dueAt(gabija.id, notes[0]?.moveKey ?? '')).toBe(true);
    },
    SLOW,
  );

  it(
    "leaves Rokas's QGD overdue at the seed date: its deadline passed, not done (R-51)",
    async () => {
      await seedPersonas(db, NOW);
      const rokas = await persona(db, 'persona-u1400@mychess.test');
      const assigned = await playerAssignments(db, rokas.id, NOW);
      expect(
        assigned
          .filter((a) => a.badges.overdue)
          .map((a) => [a.name, a.deadline, a.done]),
      ).toEqual([['Atmestas valdovės gambitas', '2026-11-01', false]]);
    },
    SLOW,
  );
});
