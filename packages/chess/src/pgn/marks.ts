/**
 * Arrows and circles embedded in PGN comments (R-65): `[%cal Ge2e4,...]`
 * draws arrows and `[%csl Gd4,...]` circles, in green, red, yellow or blue.
 * Other embedded commands, such as `[%clk]` clocks, are dropped.
 */
import type { Arrow, Circle, MarkColor } from '../repertoire/graph';

/** A PGN comment split into its prose and the marks it draws. */
export interface CommentMarks {
  text: string;
  arrows: Arrow[];
  circles: Circle[];
}

const ARROW = /^([GRYB])([a-h][1-8])([a-h][1-8])$/;
const CIRCLE = /^([GRYB])([a-h][1-8])$/;
const COMMAND = /\[%[^\]]*\]/g;

const isMarkColor = (value: string): value is MarkColor =>
  value === 'G' || value === 'R' || value === 'Y' || value === 'B';

/** The comma-separated entries of every `[%name ...]` command in `comment`. */
function entries(comment: string, name: 'cal' | 'csl'): string[] {
  const command = new RegExp(String.raw`\[%${name}\s+([^\]]*)\]`, 'g');
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
 * whitespace collapsed.
 */
export function parseMarks(comment: string): CommentMarks {
  return {
    text: comment.replace(COMMAND, ' ').replace(/\s+/g, ' ').trim(),
    arrows: entries(comment, 'cal').flatMap(toArrow),
    circles: entries(comment, 'csl').flatMap(toCircle),
  };
}
