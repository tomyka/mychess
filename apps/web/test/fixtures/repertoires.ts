// Persona repertoires as PGN (docs/personas/u1400.md, 1400-2000.md), for the
// component and feature suites. Pure data and one parse: no database.
import { importPgn, type RepertoireGraph, type Side } from '@mychess/chess';

/** Rokas's London (White): two chapters, a comment, an arrow, one variation. */
export const LONDON = [
  '[Event "London vs ...d5"]',
  '',
  '{ The London } 1. d4 { Solid [%cal Gc1f4] } d5 2. Bf4 Nf6 3. e3 e6 (3... c5 4. c3) 4. Nf3 *',
  '',
  '[Event "London vs KID"]',
  '',
  '1. d4 Nf6 2. Bf4 g6 3. e3 Bg7 4. Nf3 *',
].join('\n');

/** Gabija's Taimanov (Black): two comments and one nested variation. */
export const TAIMANOV = [
  '[Event "Taimanov"]',
  '',
  '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 { The main line } Qc7',
  '6. Be3 (6. Be2 a6 7. O-O (7. Be3 Nf6) 7... Nf6) (6. g3 a6) 6... a6',
  '{ Flexible } 7. Qd2 Nf6 *',
].join('\n');

/** The graph `text` imports to, or a thrown error. */
export function graphOf(text: string, side: Side = 'white'): RepertoireGraph {
  const imported = importPgn(text, side);
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}
