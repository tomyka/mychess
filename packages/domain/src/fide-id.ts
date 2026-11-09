import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';

/** The most digits a FIDE ID has (spec decision 5, #316). */
const FIDE_ID_MAX_DIGITS = 9;

/** Message-catalogue keys for the FIDE ID refusals; the UI translates them. */
export const FIDE_ID_REFUSALS = {
  blank: 'fide.idBlank',
  invalid: 'fide.idInvalid',
  tooLong: 'fide.idTooLong',
} as const;

export interface FideIdRefusal {
  readonly reason: (typeof FIDE_ID_REFUSALS)[keyof typeof FIDE_ID_REFUSALS];
}

/**
 * A player's FIDE ID: a positive whole number of at most nine digits,
 * branded so only a parsed number passes for one.
 */
export const fideIdSchema = z
  .number(FIDE_ID_REFUSALS.invalid)
  .int(FIDE_ID_REFUSALS.invalid)
  .min(1, FIDE_ID_REFUSALS.invalid)
  .max(10 ** FIDE_ID_MAX_DIGITS - 1, FIDE_ID_REFUSALS.invalid)
  .brand<'FideId'>();

export type FideId = z.infer<typeof fideIdSchema>;

/**
 * Reads a typed FIDE ID (spec decision 5): surrounding spaces are dropped,
 * then only ASCII digits, one to nine of them, with no leading zero, so each
 * ID has one spelling and zero is no ID.
 */
export function fideId(raw: string): Result<FideId, FideIdRefusal> {
  const digits = raw.trim();
  if (digits === '') return refuse(FIDE_ID_REFUSALS.blank);
  if (!/^[0-9]+$/.test(digits)) return refuse(FIDE_ID_REFUSALS.invalid);
  if (digits.length > FIDE_ID_MAX_DIGITS) {
    return refuse(FIDE_ID_REFUSALS.tooLong);
  }
  if (digits.startsWith('0')) return refuse(FIDE_ID_REFUSALS.invalid);
  return ok(fideIdSchema.parse(Number(digits)));
}
