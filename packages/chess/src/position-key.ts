import { validateFen } from 'chess.js';

/**
 * A position's identity, whatever the move counters: the first four FEN
 * fields (placement, side to move, castling rights, en passant square).
 * Two FENs that differ only in the halfmove clock or the move number are
 * the same position, and so the same key.
 */
export function positionKey(fen: string): string {
  const trimmed = fen.trim();
  const validation = validateFen(trimmed);
  if (!validation.ok) {
    throw new Error(`Not a valid FEN: ${validation.error ?? trimmed}`);
  }
  return trimmed.split(/\s+/).slice(0, 4).join(' ');
}
