// Synthetic broadcast data for the broadcast index tests: no real players
// or tournaments (CLAUDE.md).
import {
  broadcastMonthSchema,
  broadcastTourIdSchema,
  fideIdSchema,
  qualifyBroadcastTour,
  type BroadcastGameInput,
  type BroadcastMonth,
  type BroadcastTourId,
  type BroadcastTourOrigin,
  type BroadcastWindow,
  type FideId,
  type QueuedBroadcastTour,
} from '@mychess/domain';

export const NOW = new Date('2026-11-09T12:00:00Z');

export const month = (text: string): BroadcastMonth =>
  broadcastMonthSchema.parse(text);

export const months = (...texts: string[]): BroadcastMonth[] =>
  texts.map(month);

export const fideId = (n: number): FideId => fideIdSchema.parse(n);

export const tourId = (text: string): BroadcastTourId =>
  broadcastTourIdSchema.parse(text);

/** A synthetic broadcast game between FIDE IDs 100 (White) and 200. */
export const game = (
  n: number,
  overrides: Partial<BroadcastGameInput> = {},
): BroadcastGameInput => ({
  url: `https://lichess.org/broadcast/synthetic/round/game${String(n)}`,
  white: `White ${String(n)}`,
  whiteFideId: 100,
  black: `Black ${String(n)}`,
  blackFideId: 200,
  date: '2025-01-05',
  result: '1-0',
  eco: 'B90',
  opening: 'Sicilian Defense: Najdorf Variation',
  event: 'Synthetic Open',
  ...overrides,
});

export const gamesNumbered = (count: number): BroadcastGameInput[] =>
  Array.from({ length: count }, (_, n) => game(n));

/** The round every synthetic tournament game is of, unless said otherwise. */
export const TOUR_ROUND = tourId('Rnd00001');

/**
 * A synthetic game of `round`, with a broadcast game link of the shape
 * isGameOfTour keeps.
 */
export const tourGame = (
  n: number,
  overrides: Partial<BroadcastGameInput> = {},
  round: string = TOUR_ROUND,
): BroadcastGameInput =>
  game(n, {
    url: `https://lichess.org/broadcast/synthetic/round-1/${round}/G${String(n).padStart(7, '0')}`,
    ...overrides,
  });

/** A window wide enough for every synthetic tournament, ending at NOW. */
const QUEUE_WINDOW: BroadcastWindow = {
  oldest: month('2020-01'),
  newest: month('2026-09'),
};

/**
 * A synthetic community tournament of an approved organiser, made by
 * qualifyBroadcastTour as the server makes one (security L1).
 */
export const queuedTour = (
  id: string,
  overrides: {
    readonly name?: string;
    readonly official?: boolean;
    readonly lastRoundAt?: Date;
    readonly origin?: BroadcastTourOrigin;
  } = {},
): QueuedBroadcastTour => {
  const qualified = qualifyBroadcastTour(
    {
      id,
      name: 'Synthetic Open',
      official: false,
      finished: true,
      lastRoundAt: new Date('2026-10-20T10:00:00Z'),
      origin: { kind: 'organiser', organiser: 'paulauskas' },
      ...overrides,
    },
    QUEUE_WINDOW,
    NOW,
  );
  if (!qualified.ok) throw new Error(qualified.refusal.reason);
  return qualified.value;
};
