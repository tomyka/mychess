/**
 * What the personas hold and have done: assignments, the fork, shares,
 * personal notes and training history, from the "Seed data" tables of
 * docs/personas/*.md (M1 rows only; goals, messages, linked accounts and
 * games are M2 and M3). Repertoires are named by handle (repertoires.ts).
 * Pure data. Where a doc gives no date or leaves a detail open, the value
 * here is a seed assumption, marked as such.
 */
import { on, type PersonaKey } from './accounts';
import { NAJDORF_FORK_CHAPTERS } from './repertoires-2000plus';
import type { ChapterLines } from './lines';

const HOUR_MS = 3_600_000;
const later = (at: Date, hours: number): Date =>
  new Date(at.getTime() + hours * HOUR_MS);

export interface PersonaAssignment {
  readonly repertoire: string;
  /** A player, or the group (PERSONA_GROUP). */
  readonly to: PersonaKey | 'group';
  /** `YYYY-MM-DD`, or null for none. */
  readonly deadline: string | null;
  /** Seed assumption: an hour after the player's link (or the group). */
  readonly at: Date;
}

export const PERSONA_ASSIGNMENTS: readonly PersonaAssignment[] = [
  {
    repertoire: 'caro-kann',
    to: 'group',
    deadline: '2026-12-20',
    at: later(on('2025-11-20'), 1),
  },
  {
    repertoire: 'najdorf',
    to: '2000plus',
    deadline: null,
    at: later(on('2025-11-20'), 1),
  },
  {
    repertoire: 'najdorf-e6',
    to: '2000plus',
    deadline: null,
    at: later(on('2025-11-20'), 1),
  },
  {
    repertoire: 'queens-gambit',
    to: '1400-2000',
    deadline: '2026-12-15',
    at: later(on('2026-02-01'), 1),
  },
  {
    repertoire: 'slav',
    to: '1400-2000',
    deadline: '2026-11-30',
    at: later(on('2026-02-01'), 1),
  },
  {
    repertoire: 'italian',
    to: 'u1400',
    deadline: '2026-11-30',
    at: later(on('2026-04-12'), 1),
  },
  {
    repertoire: 'open-games',
    to: 'u1400',
    deadline: null,
    at: later(on('2026-04-12'), 1),
  },
  {
    repertoire: 'qgd',
    to: 'u1400',
    deadline: null,
    at: later(on('2026-04-12'), 1),
  },
];

/** A player's fork of an assigned repertoire, with the chapters they added. */
export interface PersonaFork {
  readonly handle: string;
  readonly player: PersonaKey;
  readonly source: string;
  readonly added: readonly ChapterLines[];
  /** Seed assumption: the day after the assignment. */
  readonly at: Date;
}

export const PERSONA_FORKS: readonly PersonaFork[] = [
  {
    handle: 'najdorf-fork',
    player: '2000plus',
    source: 'najdorf',
    added: NAJDORF_FORK_CHAPTERS,
    at: on('2025-11-21'),
  },
];

export interface PersonaShare {
  readonly repertoire: string;
  readonly coach: PersonaKey;
  readonly at: Date;
}

/** Everything else a player owns stays private (Q26). */
export const PERSONA_SHARES: readonly PersonaShare[] = [
  {
    repertoire: 'najdorf-fork',
    coach: 'coach',
    at: later(on('2025-11-21'), 1),
  },
  { repertoire: 'taimanov', coach: 'coach', at: later(on('2026-02-01'), 2) },
];

/** A player's private note on move `move` of a chapter's main line. */
export interface PersonaNote {
  readonly player: PersonaKey;
  readonly repertoire: string;
  readonly chapter: string;
  /** `4.c3` (White's fourth move) or `9...Be7` (Black's ninth). */
  readonly move: string;
  readonly text: string;
  readonly at: Date;
}

export const PERSONA_NOTES: readonly PersonaNote[] = [
  {
    player: 'u1400',
    repertoire: 'italian',
    chapter: 'Giuoco Pianissimo',
    move: '4.c3',
    text: 'Nepamiršti d3 prieš d4',
    at: on('2026-04-13'),
  },
  {
    player: '1400-2000',
    repertoire: 'taimanov',
    chapter: '6.Be2',
    move: '9.Na4',
    text: 'jei 9.Na4, tai Be7',
    at: on('2026-02-02'),
  },
];

/** A chapter learned on the day `daysAgo` before the seed date. */
interface ChapterLearned {
  readonly repertoire: string;
  readonly chapter: string;
  readonly daysAgo: number;
}

/** Lapses on one move, given on its first due reviews. */
interface MoveLapses {
  readonly repertoire: string;
  readonly chapter: string;
  readonly move: string;
  readonly count: number;
}

/**
 * A player's training up to the seed date, relative to it: the days they
 * do their due reviews, what they learned when, and their lapses.
 */
export interface PersonaTraining {
  readonly player: PersonaKey;
  readonly trainedDaysAgo: readonly number[];
  readonly learned: readonly ChapterLearned[];
  readonly lapses: readonly MoveLapses[];
}

/** `from`, `from - 1`, ... `to` (days ago, oldest first). */
const days = (from: number, to: number): number[] =>
  Array.from({ length: from - to + 1 }, (_, i) => from - i);

/** `chapters` of `repertoire`, one a day from `firstDaysAgo` on. */
const oneADay = (
  firstDaysAgo: number,
  repertoire: string,
  chapters: readonly string[],
): ChapterLearned[] =>
  chapters.map((chapter, i) => ({
    repertoire,
    chapter,
    daysAgo: firstDaysAgo - i,
  }));

export const PERSONA_TRAINING: readonly PersonaTraining[] = [
  {
    // u1400.md: 21 days of reviews, a 3-day gap 9-11 days ago and an
    // active 4-day streak. Both hold only with a second gap, 5 days ago
    // (seed assumption). Trained daily, the scheduler leaves none of the
    // doc's lines due on the seed date, so the "about 12 due" that
    // U1-M1-3 reviews comes from group homework: yesterday he learned the
    // Caro-Kann Exchange (10 moves, the default daily new limit, R-62),
    // first due on the seed date (R-58). Seed assumption: the doc says
    // nothing of his Caro-Kann training.
    player: 'u1400',
    trainedDaysAgo: [...days(20, 12), ...days(8, 6), ...days(4, 1)],
    learned: [
      ...oneADay(20, 'italian', [
        'Giuoco Pianissimo',
        'Two Knights, transposes',
      ]),
      ...oneADay(18, 'open-games', ['Italian', 'Ruy Lopez']),
      { repertoire: 'caro-kann', chapter: 'Exchange', daysAgo: 1 },
    ],
    lapses: [
      {
        repertoire: 'open-games',
        chapter: 'Ruy Lopez',
        move: '6...b5',
        count: 2,
      },
      {
        repertoire: 'open-games',
        chapter: 'Ruy Lopez',
        move: '7...d6',
        count: 2,
      },
    ],
  },
  {
    // 1400-2000.md: 60 days of reviews, then a gap, leaving the 80+
    // cards due that G-M1-4 clears. Read literally (9 days off, back for
    // the last 2), the scheduler leaves none due, so the seed reads the
    // gap as running to the seed date: no reviews in the last 11 days
    // (seed assumption). "Mostly learned" is every chapter of the Queen's
    // Gambit and the Taimanov; of the Slav, all but the Exchange and vs
    // London. Only young cards fall due in 11 days, so the Taimanov is
    // learned three weeks ago (imported earlier, drilled later) and the
    // group Caro-Kann, her "second weapon", just before the gap (seed
    // assumptions: the doc gives no learning dates).
    player: '1400-2000',
    trainedDaysAgo: days(60, 12),
    learned: [
      ...oneADay(60, 'queens-gambit', [
        'QGD Exchange, Carlsbad',
        'Slav, 4...dxc4 5.a4',
        'QGA, 3.e4',
        'Albin Countergambit',
        'Nimzo-Indian, Rubinstein',
        "King's Indian, Classical",
      ]),
      ...oneADay(48, 'slav', ['Main line 5.a4', '4.e3 Bf5']),
      ...oneADay(20, 'taimanov', [
        'English Attack',
        '6.Be2',
        '6.g3',
        '3.Nc3 move order',
        'Alapin',
        'Smith-Morra',
      ]),
      ...oneADay(16, 'caro-kann', [
        'Advance, Short variation',
        'Classical',
        'Exchange',
        'Panov',
        'Two Knights',
      ]),
    ],
    lapses: [
      { repertoire: 'taimanov', chapter: '6.Be2', move: '9...Be7', count: 4 },
    ],
  },
  {
    // 2000plus.md: 11 months of reviews (335 days, every day: seed
    // assumption) from his first day with the coach, the last 19 days
    // without any, so cards are due for D-M1-5 (trained up to the seed
    // date, the scheduler leaves none due; the doc's 150 needs the bulk
    // extension, not seeded). The Catalans and the Nimzo fully in review;
    // the fork's 6.h3 and 6.Bc4 chapters still to learn; 3 lapses on
    // 19...Bb3.
    player: '2000plus',
    trainedDaysAgo: days(353, 19),
    learned: [
      ...oneADay(353, 'catalan', [
        'Open 7.Qc2 a6 8.Qxc4',
        '6...c5',
        'Closed 6...Nbd7',
        '3...Bb4+',
        '1...g6 / 1...c5 / 1...f5',
      ]),
      ...oneADay(348, 'catalan-a4', ['Open 8.a4 Bd7']),
      ...oneADay(347, 'nimzo', [
        'Nimzo 4.Qc2',
        'Nimzo 4.e3',
        'Nimzo 4.f3',
        'Nimzo 4.Bg5',
        'QID 4.g3 Ba6',
        'QID Petrosian',
        'vs London',
        'Mikenas',
      ]),
      ...oneADay(339, 'najdorf-fork', [
        'EA 6...e5',
        'Poisoned Pawn',
        '6.Be2',
        'Moscow 3.Bb5+',
        'Alapin',
        'Grand Prix',
      ]),
    ],
    lapses: [
      {
        repertoire: 'najdorf-fork',
        chapter: 'EA 6...e5',
        move: '19...Bb3',
        count: 3,
      },
    ],
  },
  {
    // coach.md: "a few weeks of reviews" on his own Catalan (three weeks:
    // seed assumption).
    player: 'coach',
    trainedDaysAgo: days(21, 1),
    learned: oneADay(21, 'coach-catalan', ['Open 7.Qc2 a6 8.Qxc4']),
    lapses: [],
  },
];
