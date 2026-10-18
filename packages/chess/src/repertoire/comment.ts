/**
 * A move comment in the one form PGN carries unchanged (R-105): one
 * paragraph, whitespace collapsed, no `}` (it would end the brace comment)
 * and no embedded `[%...]` command (it would come back as marks). What
 * export writes is then exactly what import reads back.
 */
import { parseMarks } from '../pgn/marks';

/** The comment `text` keeps, or null when nothing is left of it. */
export function normalizeComment(text: string): string | null {
  const kept = parseMarks(text.replace(/\}/g, ' ')).text;
  return kept === '' ? null : kept;
}
