import type { Arrow, Circle, MarkColor, Marks } from '@mychess/chess';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { isKey } from './squares';

const BRUSHES: Record<MarkColor, string> = {
  G: 'green',
  R: 'red',
  Y: 'yellow',
  B: 'blue',
};
const COLORS: ReadonlyMap<string, MarkColor> = new Map([
  ['green', 'G'],
  ['red', 'R'],
  ['yellow', 'Y'],
  ['blue', 'B'],
]);

/** A move's arrows and circles as chessground shapes. */
export function shapesOf({ arrows, circles }: Marks): DrawShape[] {
  const lines = arrows.flatMap((a): DrawShape[] =>
    isKey(a.from) && isKey(a.to)
      ? [{ orig: a.from, dest: a.to, brush: BRUSHES[a.color] }]
      : [],
  );
  const rings = circles.flatMap((c): DrawShape[] =>
    isKey(c.square) ? [{ orig: c.square, brush: BRUSHES[c.color] }] : [],
  );
  return [...lines, ...rings];
}

/** The shapes drawn with the mouse, as marks; a brush we do not use is skipped. */
export function marksOf(shapes: readonly DrawShape[]): Marks {
  const arrows: Arrow[] = [];
  const circles: Circle[] = [];
  for (const shape of shapes) {
    const color = COLORS.get(shape.brush ?? '');
    if (color === undefined) continue;
    if (shape.dest === undefined || shape.dest === shape.orig)
      circles.push({ square: shape.orig, color });
    else arrows.push({ from: shape.orig, to: shape.dest, color });
  }
  return { arrows, circles };
}

/**
 * Draw mode's tap (decision 16): the same square twice toggles a circle,
 * two squares toggle an arrow. The same colour again removes the mark; another
 * colour recolours it.
 */
export function toggleMark(
  marks: Marks,
  orig: string,
  dest: string,
  color: MarkColor,
): Marks {
  if (orig === dest) {
    const other = marks.circles.filter((c) => c.square !== orig);
    const same = marks.circles.some(
      (c) => c.square === orig && c.color === color,
    );
    return {
      ...marks,
      circles: same ? other : [...other, { square: orig, color }],
    };
  }
  const other = marks.arrows.filter((a) => a.from !== orig || a.to !== dest);
  const same = marks.arrows.some(
    (a) => a.from === orig && a.to === dest && a.color === color,
  );
  return {
    ...marks,
    arrows: same ? other : [...other, { from: orig, to: dest, color }],
  };
}
