/** Helpers shared by the PGN tests; no runtime code imports this file. */
import { DEFAULT_POSITION } from 'chess.js';
import { positionKey } from '../position-key';
import type { Side } from '../repertoire/graph';
import { importPgn, type ImportedRepertoire } from './import-pgn';

/** The standard start position's key. */
export const START = positionKey(DEFAULT_POSITION);

/** `value`, or a thrown error when it is missing. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The repertoire `text` imports to, or a thrown error naming the refusal. */
export function imported(
  text: string,
  side: Side = 'white',
): ImportedRepertoire {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}
