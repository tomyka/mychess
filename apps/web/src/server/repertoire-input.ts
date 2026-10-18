import { SIDES, type Side } from '@mychess/chess';
import {
  REPERTOIRE_ISSUES,
  repertoireNameSchema,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';

/** The refusals the "new repertoire" form shows. */
const NEW_REPERTOIRE_ISSUES = {
  nameBlank: REPERTOIRE_ISSUES.nameBlank,
  nameTooLong: REPERTOIRE_ISSUES.nameTooLong,
  sideInvalid: REPERTOIRE_ISSUES.sideInvalid,
} as const;

export type NewRepertoireRefusalKey =
  (typeof NEW_REPERTOIRE_ISSUES)[keyof typeof NEW_REPERTOIRE_ISSUES];

const KEYS: readonly NewRepertoireRefusalKey[] = Object.values(
  NEW_REPERTOIRE_ISSUES,
);

const newRepertoireSchema = z.object({
  name: repertoireNameSchema,
  side: z.enum(SIDES, NEW_REPERTOIRE_ISSUES.sideInvalid),
});

/** A missing field reads as empty text, so it is refused as blank. */
const text = (raw: FormDataEntryValue | null): string =>
  typeof raw === 'string' ? raw : '';

/** The "new repertoire" form's name and side. */
export function parseNewRepertoire(
  form: FormData,
): Result<
  { name: string; side: Side },
  { readonly reason: NewRepertoireRefusalKey }
> {
  const parsed = newRepertoireSchema.safeParse({
    name: text(form.get('name')),
    side: text(form.get('side')),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const message = parsed.error.issues[0]?.message;
  const reason =
    KEYS.find((key) => key === message) ?? NEW_REPERTOIRE_ISSUES.nameBlank;
  return { ok: false, refusal: { reason } };
}
