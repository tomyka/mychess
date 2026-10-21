import {
  SHARE_REFUSALS,
  type Result,
  type ShareRefusal,
} from '@mychess/domain';
import { z } from 'zod';
import { accountIdSchema } from './account-id';
import { refusalAt } from './parse-refusal';

/** The share form: the repertoire and the coaches ticked. */
export interface SharesForm {
  readonly repertoireId: string;
  readonly coachIds: readonly string[];
}

const sharesSchema = z.object({
  repertoireId: z.uuid(),
  coachIds: z.array(accountIdSchema).max(100),
});

/**
 * The share form's fields (R-42). A malformed repertoire reads as not the
 * owner's, as one that does not exist would; a malformed coach as not
 * linked.
 */
export function parseShares(form: FormData): Result<SharesForm, ShareRefusal> {
  const parsed = sharesSchema.safeParse({
    repertoireId: form.get('repertoireId'),
    coachIds: form.getAll('coachIds'),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = refusalAt<ShareRefusal['reason']>(
    parsed.error,
    { coachIds: SHARE_REFUSALS.notLinked },
    SHARE_REFUSALS.notOwner,
  );
  return { ok: false, refusal: { reason } };
}
