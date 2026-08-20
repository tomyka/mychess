import { readFileSync } from 'node:fs';
import { parsePgn } from '../src/lib/pgn/parser';
import { planImport } from '../src/lib/pgn-import';

const path = process.argv[2];
const pgnText = readFileSync(path, 'utf-8');

console.log('file size (chars):', pgnText.length);

let t0 = performance.now();
const games = parsePgn(pgnText);
let t1 = performance.now();
console.log('parsePgn: games =', games.length, 'took', (t1 - t0).toFixed(1), 'ms');
for (const g of games) {
  console.log('  game:', JSON.stringify(g.headers.White), '/', JSON.stringify(g.headers.Black), '-> moves:', g.moves.length);
}

t0 = performance.now();
const plan = planImport(pgnText, 'white');
t1 = performance.now();
console.log('planImport took', (t1 - t0).toFixed(1), 'ms');
if ('error' in plan) {
  console.log('ERROR:', plan.error);
} else {
  console.log('planImport: gameCount =', plan.gameCount, 'total move rows =', plan.moves.length);
  const uniqueEdges = new Set(plan.moves.map((m) => `${m.fromFen}|${m.san}`));
  console.log('unique (fromFen, san) edges across ALL games combined:', uniqueEdges.size);
  const playerMoves = plan.moves.filter((m) => m.is_player_turn).length;
  console.log('is_player_turn=true count (studied as white):', playerMoves);
}

console.log('\n--- retry with CRLF normalized to LF ---');
const normalized = pgnText.replace(/\r\n/g, '\n');
const games2 = parsePgn(normalized);
console.log('parsePgn (normalized): games =', games2.length);
for (const g of games2) {
  console.log('  game:', JSON.stringify(g.headers.White), '/', JSON.stringify(g.headers.Black), '-> moves:', g.moves.length);
}
const plan2 = planImport(normalized, 'white');
if (!('error' in plan2)) {
  const uniqueEdges2 = new Set(plan2.moves.map((m) => `${m.fromFen}|${m.san}`));
  console.log('normalized: total move rows =', plan2.moves.length, 'unique edges =', uniqueEdges2.size);
}

console.log('\n--- chunking analysis (on fixed-parser raw-file plan) ---');
const uniqueFens = Array.from(new Set(plan['moves'] ? [] : []));
if (!('error' in plan)) {
  const fens = Array.from(new Set(plan.moves.flatMap((m) => [m.fromFen, m.toFen])));
  console.log('unique FEN count:', fens.length);
  console.log('avg FEN length:', (fens.reduce((s, f) => s + f.length, 0) / fens.length).toFixed(1));
  function chunkByLength(values: string[], maxChars: number): string[][] {
    const chunks: string[][] = [];
    let current: string[] = [];
    let length = 0;
    for (const value of values) {
      if (current.length > 0 && length + value.length + 1 > maxChars) {
        chunks.push(current);
        current = [];
        length = 0;
      }
      current.push(value);
      length += value.length + 1;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
  const chunks = chunkByLength(fens, 1500);
  console.log('number of SELECT round-trips (chunkByLength, 1500 chars):', chunks.length);
  console.log('avg fens per chunk:', (fens.length / chunks.length).toFixed(1));
  const CHUNK = 500;
  console.log('number of position upsert round-trips (CHUNK=500):', Math.ceil(fens.length / CHUNK));
  console.log('number of move upsert round-trips (CHUNK=500):', Math.ceil(plan.moves.length / CHUNK));
  console.log('TOTAL sequential round trips (upsert + select + upsert):', Math.ceil(fens.length/CHUNK) + chunks.length + Math.ceil(plan.moves.length/CHUNK) + 1);
}
