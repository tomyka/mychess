// Writes src/openings/data/eco.json: one entry per ECO code from
// lichess-org/chess-openings (CC0 1.0 Universal). Ported from v1
// (`scripts/generate-eco-data.ts`). Run from packages/chess on Node 24, which
// loads the TypeScript parser directly: `node scripts/generate-eco.mjs`.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { oneEntryPerCode, parseEcoTsv } from '../src/openings/eco-tsv.ts';

const VOLUMES = ['a', 'b', 'c', 'd', 'e'];
const BASE_URL =
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const OUT_PATH = fileURLToPath(
  new URL('../src/openings/data/eco.json', import.meta.url),
);

async function fetchVolume(letter) {
  const res = await fetch(`${BASE_URL}/${letter}.tsv`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${letter}.tsv: HTTP ${res.status}`);
  }
  return parseEcoTsv(await res.text());
}

// Writes the data as JSON and formats it with the repo's prettier, so a
// regenerated file passes `pnpm format:check` without a manual step.
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  execSync(`pnpm exec prettier --write "${path}"`, { stdio: 'inherit' });
}

async function main() {
  const all = [];
  for (const letter of VOLUMES) {
    all.push(...(await fetchVolume(letter)));
  }
  const entries = oneEntryPerCode(all);
  writeJson(OUT_PATH, entries);
  process.stdout.write(`Wrote ${entries.length} openings to ${OUT_PATH}\n`);
}

main().catch((error) => {
  console.error('ECO data generation failed:', error);
  process.exit(1);
});
