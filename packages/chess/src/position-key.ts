import { Chess, validateFen } from 'chess.js';

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
