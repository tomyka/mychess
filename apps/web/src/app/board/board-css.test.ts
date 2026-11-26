// @vitest-environment node
// The board's coordinates as board.css draws them (#381 part 4): each
// square's own coordinate colour, measured at 3:1 in tokens.test.ts, and a
// larger size from lg up, where the board is larger.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./board.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is `selector`. */
function rule(selector: string, css: string = CSS): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

describe('board.css coordinates', () => {
  it('colours a light square’s coordinate and a dark one’s with their tokens', () => {
    expect(rule('.cg-wrap coords coord.coord-light')).toContain(
      'color: var(--color-board-coord-on-light);',
    );
    expect(rule('.cg-wrap coords coord.coord-dark')).toContain(
      'color: var(--color-board-coord-on-dark);',
    );
  });

  it('writes the file letters in lower case, as chess notation does: chessground’s "B" reads as a bishop (sign-off)', () => {
    expect(rule('.cg-wrap coords.files')).toContain('text-transform: none;');
  });

  it('writes them at 0.75rem, and 0.875rem from lg up', () => {
    expect(rule('.cg-wrap coords')).toContain('font-size: 0.75rem;');
    const lg = CSS.slice(CSS.indexOf('@media (width >= 64rem) {'));
    expect(rule('.cg-wrap coords', lg)).toContain('font-size: 0.875rem;');
  });
});
