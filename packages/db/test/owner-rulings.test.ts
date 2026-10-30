import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #306: every ruling in docs/owner-rulings.md has its own number, in
 * ascending order, and every R-n the code cites is one of them. S7 reused
 * R-150, and a wrong number had already reached code before anyone saw it.
 * It lives here because db tests may read files (dependency-cruiser).
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE = new Set(['.ts', '.tsx', '.mjs', '.cjs']);
const SKIPPED = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);

/** The numbers the rulings file defines, in file order. */
function definedRulings(): number[] {
  const text = readFileSync(join(ROOT, 'docs/owner-rulings.md'), 'utf8');
  return [...text.matchAll(/^- (?:~~)?\*\*R-(\d+)\*\*/gm)].map((m) =>
    Number(m[1]),
  );
}

/** Every source file under `dir`, build output and dependencies left out. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
    return SOURCE.has(extname(entry.name)) ? [path] : [];
  });
}

/** Each cited R-n, with a file that cites it. */
function citedRulings(): Map<number, string> {
  const cited = new Map<number, string>();
  const files = ['packages', 'apps'].flatMap((d) => sourceFiles(join(ROOT, d)));
  for (const file of files)
    for (const match of readFileSync(file, 'utf8').matchAll(/\bR-(\d+)\b/g))
      cited.set(Number(match[1]), file.slice(ROOT.length));
  return cited;
}

describe('owner rulings', () => {
  const defined = definedRulings();

  it('are numbered once each, in ascending order', () => {
    expect(defined.length).toBeGreaterThan(100);
    const ascending = defined.every(
      (n, i) => i === 0 || n > (defined[i - 1] ?? n),
    );
    expect(ascending).toBe(true);
  });

  it('cover every R-n the code cites', () => {
    const known = new Set(defined);
    const unknown = [...citedRulings()]
      .filter(([n]) => !known.has(n))
      .map(([n, file]) => `R-${String(n)} in ${file}`);
    expect(unknown).toEqual([]);
  });
});
