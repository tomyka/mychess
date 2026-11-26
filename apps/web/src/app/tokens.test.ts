// @vitest-environment node
// Every text, control and focus pair in docs/design/README.md's contrast
// table, read from tokens.css itself, in both themes (WCAG 2.2 AA).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (): string =>
  readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Pair = readonly [light: string, dark: string];

/** `--color-<name>: light-dark(#xxxxxx, #yyyyyy)` or a single hex. */
function token(name: string): Pair {
  const CSS = read();
  const both = new RegExp(
    `--color-${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`,
    'i',
  ).exec(CSS);
  if (both?.[1] !== undefined && both[2] !== undefined)
    return [both[1], both[2]];
  const one = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(CSS);
  if (one?.[1] === undefined) throw new Error(`no token ${name}`);
  return [one[1], one[1]];
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

const ratio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const TEXT = 4.5;
const UI = 3;

const PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ['fg', 'bg', TEXT],
  ['fg', 'surface', TEXT],
  ['fg-muted', 'bg', TEXT],
  ['fg-muted', 'surface', TEXT],
  // A disabled primary button's label (#381 part 4): the button does not
  // fade, so a pending label ("Importing") stays readable.
  ['fg-muted', 'sunken', TEXT],
  ['accent', 'bg', TEXT],
  ['accent', 'surface', TEXT],
  ['accent', 'accent-subtle', TEXT],
  ['accent-fg', 'accent', TEXT],
  ['focus', 'bg', UI],
  ['focus', 'surface', UI],
  ['border-strong', 'bg', UI],
  ['border-strong', 'surface', UI],
  // The move badges' white glyph (owner choice D, #381): a graphic, 3:1.
  ['board-badge-glyph', 'board-badge-correct', UI],
  ['board-badge-glyph', 'board-badge-wrong', UI],
  // The board's coordinates (#381 part 4): small bold text on the square
  // they sit in, at 3:1; brown on a light square, white on a dark one.
  ['board-coord-on-light', 'board-light', UI],
  ['board-coord-on-dark', 'board-dark', UI],
  ...(['success', 'error', 'due', 'learned'] as const).flatMap(
    (s) =>
      [
        [s, 'bg', TEXT],
        [s, 'surface', TEXT],
        [s, `${s}-subtle`, TEXT],
        ['on-state', s, TEXT],
      ] as const,
  ),
];

describe('tokens.css contrast (WCAG 2.2 AA)', () => {
  it.each(PAIRS)('%s on %s reaches %d:1 in both themes', (fg, bg, min) => {
    const [fgLight, fgDark] = token(fg);
    const [bgLight, bgDark] = token(bg);
    expect(ratio(fgLight, bgLight)).toBeGreaterThanOrEqual(min);
    expect(ratio(fgDark, bgDark)).toBeGreaterThanOrEqual(min);
  });

  it('measures black on white as 21:1 and a colour on itself as 1:1', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#0b63c5', '#0b63c5')).toBe(1);
  });
});
