// The ECO table: one entry per code (500), each code's shortest line from
// lichess-org/chess-openings (CC0 1.0 Universal).
//
// The data is `eco.json`, written by `scripts/generate-eco.mjs`; do not edit
// it by hand. It is JSON rather than a TypeScript literal because a 500-entry
// literal is far past the lint `max-lines` budget for a source file.
import data from './eco.json';

export interface EcoEntry {
  /** ECO code, `A00` to `E99`. */
  readonly code: string;
  /** English name, as lichess spells it. */
  readonly name: string;
  /** The line from the standard start position, in SAN. */
  readonly moves: readonly string[];
}

export const ECO: readonly EcoEntry[] = data;
