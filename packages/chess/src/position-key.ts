import { Chess, DEFAULT_POSITION, validateFen } from 'chess.js';

/**
 * A position's identity, whatever the move counters: the first four FEN
 * fields (placement, side to move, castling rights, en passant square).
 * The FEN is normalised through chess.js first, so an en passant square is
 * kept only when an en passant capture is legal: a position written by
 * hand and the same position reached by moves share one key.
 */
export function positionKey(fen: string): string {
  const trimmed = fen.trim();
  const validation = validateFen(trimmed);
  if (!validation.ok) {
    throw new Error(`Not a valid FEN: ${validation.error ?? trimmed}`);
  }
  return new Chess(trimmed).fen().split(' ').slice(0, 4).join(' ');
}

/** A FEN chess.js accepts for a position key; counters do not affect legality. */
export const fenOf = (key: string): string => `${key} 0 1`;

/** The side to move in a position key: its second field. */
export function sideToMove(key: string): 'w' | 'b' {
  return key.split(' ')[1] === 'b' ? 'b' : 'w';
}

/** The standard start position's key: where builder chapters start. */
export const START_KEY = positionKey(DEFAULT_POSITION);
