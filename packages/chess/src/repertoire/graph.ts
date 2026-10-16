/**
 * A repertoire as a position-keyed move graph (ruling Q27): moves are keyed by
 * the position they leave, so transpositions merge and a move is trained once.
 * Plain readonly values; every function here is pure.
 */

import { sideToMove } from '../position-key';

export type Side = 'white' | 'black';
export type MarkColor = 'G' | 'R' | 'Y' | 'B';
export interface Arrow {
  readonly from: string;
  readonly to: string;
  readonly color: MarkColor;
}
export interface Circle {
  readonly square: string;
  readonly color: MarkColor;
}

/** The arrows and circles drawn on a move. */
export interface Marks {
  readonly arrows: readonly Arrow[];
  readonly circles: readonly Circle[];
}

export type ChapterNameSource =
  | { readonly kind: 'custom'; readonly name: string }
  | { readonly kind: 'eco'; readonly eco: string }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'index'; readonly number: number };

export interface Chapter {
  readonly id: string;
  readonly rootKey: string;
  readonly intro: string | null;
  readonly nameSource: ChapterNameSource;
}

export interface RepertoireMove {
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly uci: string;
  readonly arrows: readonly Arrow[];
  readonly circles: readonly Circle[];
  readonly chapters: readonly string[];
}

export interface RepertoireGraph {
  readonly side: Side;
  readonly chapters: readonly Chapter[];
  readonly moves: readonly RepertoireMove[];
}

/** A move's identity; for a player move it is also its review key. */
export const moveKey = (fromKey: string, san: string): string =>
  `${fromKey}|${san}`;

/** Whether `move` is played by the repertoire's side. */
export function isPlayerMove(
  graph: Pick<RepertoireGraph, 'side'>,
  move: Pick<RepertoireMove, 'from'>,
): boolean {
  return (sideToMove(move.from) === 'w') === (graph.side === 'white');
}

export function playerKeys(graph: RepertoireGraph): string[] {
  return graph.moves
    .filter((m) => isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));
}

/** The chapter with this id, if the repertoire has one. */
export function chapterOf(
  graph: RepertoireGraph,
  chapterId: string,
): Chapter | undefined {
  return graph.chapters.find((c) => c.id === chapterId);
}
