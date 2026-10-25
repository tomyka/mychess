import { lines, type RepertoireMove } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { currentLineIndex } from './current-line';

const london = graphOf(LONDON);
const [first, second] = london.chapters;
if (first === undefined || second === undefined) throw new Error('fixture');
const [main = [], c5 = []] = lines(london, first.id);

/** The SANs of `path`, to read a failure by. */
const sans = (path: readonly RepertoireMove[]) => path.map((m) => m.san);

describe('currentLineIndex', () => {
  it('reads the fixture as two lines, 3...e6 then 3...c5', () => {
    expect(sans(main)).toEqual(['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3']);
    expect(sans(c5)).toEqual(['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'c5', 'c3']);
  });

  it('is the first line the path starts', () => {
    expect(currentLineIndex(london, first.id, main.slice(0, 1))).toBe(0);
    expect(currentLineIndex(london, first.id, main)).toBe(0);
    expect(currentLineIndex(london, first.id, c5.slice(0, 6))).toBe(1);
    expect(currentLineIndex(london, first.id, c5)).toBe(1);
  });

  it('matches moves by position and SAN, not by object', () => {
    const copy = c5.map((m) => ({ ...m }));
    expect(currentLineIndex(london, first.id, copy)).toBe(1);
  });

  it('is null at the chapter root', () => {
    expect(currentLineIndex(london, first.id, [])).toBeNull();
  });

  it('is null for a path no line of the chapter starts', () => {
    // The KID chapter's 1...Nf6 is not in the ...d5 chapter.
    const [kid = []] = lines(london, second.id);
    expect(currentLineIndex(london, first.id, kid.slice(0, 2))).toBeNull();
  });
});
