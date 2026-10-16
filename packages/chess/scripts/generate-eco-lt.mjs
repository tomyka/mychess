// Writes src/openings/data/eco-lt.json: the Lithuanian name for every ECO
// code, from šachmatai.lt's opening encyclopaedia. Ported from v1
// (`scripts/generate-eco-data-lt.ts`, v1 issue #158). Run from packages/chess
// on Node 24: `node scripts/generate-eco-lt.mjs`.
//
// Each name gets the "safe tidy" of ruling R-77 (`tidyLtName`): whitespace,
// castling with the letter O, no space after a move number, and the comma
// before a trailing move qualifier. Wording stays verbatim.
//
// Deliberately a separate command from generate-eco.mjs: that one fetches
// lichess's TSVs, this one scrapes a third party's HTML, which is far more
// likely to break. A markup change on šachmatai.lt cannot stop the English
// data being regenerated.
//
// The volume index pages (`?id=E`) are not the source: they carry only ten
// decade headings, several the placeholder "Įvairūs debiutai". The per-code
// names live on the decade pages (`?id=E0` … `?id=E9`), 50 in total.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDecadePage } from '../src/openings/eco-lt-parse.ts';
import { tidyLtName } from '../src/openings/eco-lt-tidy.ts';

const BASE_URL = 'http://www.xn--achmatai-4wb.lt/debiutu_enciklopedija.php';
const OUT_PATH = fileURLToPath(
  new URL('../src/openings/data/eco-lt.json', import.meta.url),
);
const VOLUMES = ['A', 'B', 'C', 'D', 'E'];

async function fetchDecade(decade) {
  const res = await fetch(`${BASE_URL}?id=${decade}`);
  if (!res.ok) throw new Error(`Failed to fetch ${decade}: HTTP ${res.status}`);
  const found = parseDecadePage(await res.text(), decade);
  if (Object.keys(found).length === 0) {
    throw new Error(
      `${decade} yielded no names: the page markup has probably changed.`,
    );
  }
  return found;
}

// Writes the data as JSON and formats it with the repo's prettier, so a
// regenerated file passes `pnpm format:check` without a manual step.
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  execSync(`pnpm exec prettier --write "${path}"`, { stdio: 'inherit' });
}

async function main() {
  const names = {};
  for (const volume of VOLUMES) {
    for (let digit = 0; digit <= 9; digit++) {
      const decade = `${volume}${digit}`;
      const found = await fetchDecade(decade);
      Object.assign(names, found);
      process.stdout.write(`${decade}:${Object.keys(found).length} `);
    }
  }
  process.stdout.write('\n');

  const sorted = Object.fromEntries(
    Object.entries(names)
      .map(([code, name]) => [code, tidyLtName(name)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  writeJson(OUT_PATH, sorted);
  process.stdout.write(
    `Wrote ${Object.keys(sorted).length} Lithuanian names to ${OUT_PATH}\n`,
  );
}

main().catch((error) => {
  console.error('Lithuanian ECO data generation failed:', error);
  process.exit(1);
});
