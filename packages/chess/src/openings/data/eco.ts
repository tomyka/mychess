// Every named line of lichess-org/chess-openings (CC0 1.0 Universal), with
// the key of the position it ends in (R-216).
//
// The data is `eco.json`, written by `scripts/generate-eco.mjs`; do not edit
// it by hand. It is JSON rather than a TypeScript literal because a table of
// thousands of lines is far past the lint `max-lines` budget for a source
// file.
import { type EcoEntry, oneEntryPerCode } from '../eco-tsv';
import data from './eco.json' with { type: 'json' };

export type { EcoEntry } from '../eco-tsv';

/** Every named line, in lichess order (a later line wins a shared position). */
export const ECO: readonly EcoEntry[] = data;

/** Each code's family line: its shortest, the first on a tie. */
export const ECO_FAMILIES: readonly EcoEntry[] = oneEntryPerCode(ECO);
