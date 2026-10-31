// The browser never loads the ECO opening table (S3 decision 17, #280):
// chapter names are resolved on the server, which passes the page only the
// names it shows. A client module that reaches the classifier (for example
// through `removeMove`, which renames the chapter) puts the whole table in a
// chunk. This reads the production build the suite runs against (in CI the
// image's own chunks, copied out by ci.yml's e2e job). Locally the
// suite reuses a running server (reuseExistingServer), so this reads whatever
// `.next` build is on disk: build first, or it checks a stale bundle.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { z } from 'zod';

const STATIC = fileURLToPath(new URL('../.next/static', import.meta.url));

// The tables are read as data: Playwright's loader cannot import the chess
// package, whose JSON imports need an import attribute it does not add.
const ECO_DATA = new URL(
  '../../../packages/chess/src/openings/data/',
  import.meta.url,
);

const ecoEntry = z.object({ name: z.string() });

/**
 * The opening names in both languages. A name with a quote or a backslash
 * is left out: the bundler escapes it inside the inlined JSON, so it would
 * never match.
 */
async function openingNames(): Promise<string[]> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(new URL(file, ECO_DATA), 'utf8'));
  const english = z.array(ecoEntry).parse(await read('eco.json'));
  const lithuanian = z
    .record(z.string(), z.string())
    .parse(await read('eco-lt.json'));
  const names = [...english.map((e) => e.name), ...Object.values(lithuanian)];
  return [...new Set(names)].filter((name) => !/['"\\]/.test(name));
}

async function scripts(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => join(e.parentPath, e.name));
}

test('no client chunk carries an ECO opening name', async () => {
  // The build is the same for every device; one project reads it.
  test.skip(test.info().project.name !== 'desktop-chromium');
  const names = await openingNames();
  expect(names.length).toBeGreaterThan(0);
  const files = await scripts(STATIC);
  expect(files.length).toBeGreaterThan(0);
  const found: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const hits = names.filter((name) => text.includes(name));
    if (hits.length > 0) found.push(`${file}: ${hits.slice(0, 3).join(', ')}`);
  }
  expect(found).toEqual([]);
});
