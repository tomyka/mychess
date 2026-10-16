/**
 * Arrows and circles embedded in PGN comments (R-65): `[%cal Ge2e4,...]`
 * draws arrows and `[%csl Gd4,...]` circles, in green, red, yellow or blue.
 * Other embedded commands, such as `[%clk]` clocks, are dropped.
 */
import type { Arrow, Circle, MarkColor, Marks } from '../repertoire/graph';

/** A PGN comment split into its prose and the marks it draws. */
export interface CommentMarks extends Marks {
  readonly text: string;
}

const ARROW = /^([GRYB])([a-h][1-8])([a-h][1-8])$/;
const CIRCLE = /^([GRYB])([a-h][1-8])$/;
/** No `[` inside, so an unclosed command cannot make matching quadratic. */
const COMMAND = /\[%[^\][]*\]/g;

const isMarkColor = (value: string): value is MarkColor =>
  value === 'G' || value === 'R' || value === 'Y' || value === 'B';

/** The identity of an arrow or a circle, for merging marks without repeats. */
export const markKey = (mark: Arrow | Circle): string =>
  'square' in mark
    ? `c${mark.color}${mark.square}`
    : `a${mark.color}${mark.from}${mark.to}`;

/** The comma-separated entries of every `[%name ...]` command in `comment`. */
function entries(comment: string, name: 'cal' | 'csl'): string[] {
  const command = new RegExp(String.raw`\[%${name}\s+([^\][]*)\]`, 'g');
  return [...comment.matchAll(command)].flatMap((match) =>
    (match[1] ?? '').split(',').map((entry) => entry.trim()),
  );
}

function toArrow(entry: string): Arrow[] {
  const [, color = '', from = '', to = ''] = ARROW.exec(entry) ?? [];
  return isMarkColor(color) ? [{ from, to, color }] : [];
}

function toCircle(entry: string): Circle[] {
  const [, color = '', square = ''] = CIRCLE.exec(entry) ?? [];
  return isMarkColor(color) ? [{ square, color }] : [];
}

/**
 * Reads the arrows and circles of a PGN comment, skipping malformed
 * entries, and returns the comment without any embedded command, its
 * whitespace collapsed. An arrow from a square to itself is a circle there,
 * as lichess draws it.
 */
export function parseMarks(comment: string): CommentMarks {
  const drawn = entries(comment, 'cal').flatMap(toArrow);
  const points = drawn.filter((arrow) => arrow.from === arrow.to);
  return {
    text: comment.replace(COMMAND, ' ').replace(/\s+/g, ' ').trim(),
    arrows: drawn.filter((arrow) => arrow.from !== arrow.to),
    circles: [
      ...entries(comment, 'csl').flatMap(toCircle),
      ...points.map(({ from, color }) => ({ square: from, color })),
    ],
  };
}
