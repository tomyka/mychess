import { profileSchema, type Profile, type Result } from '@mychess/domain';

/** The catalogue key of every refusal a profile form can show. */
export type ProfileRefusalKey =
  'displayName.blank' | 'displayName.tooLong' | 'account.localeInvalid';

export interface ProfileRefusal {
  readonly reason: ProfileRefusalKey;
}

const KEYS = new Map<string, ProfileRefusalKey>([
  ['displayName.blank', 'displayName.blank'],
  ['displayName.tooLong', 'displayName.tooLong'],
  ['account.localeInvalid', 'account.localeInvalid'],
]);

// The language refusal covers every locale issue; a name that is not text
// at all (missing, or a file) is the only other issue, and reads as blank.
const refusalKey = (message: string | undefined): ProfileRefusalKey =>
  KEYS.get(message ?? '') ?? 'displayName.blank';

/** The display name and language from a form, parsed at the edge. */
export function parseProfileInput(
  form: FormData,
): Result<Profile, ProfileRefusal> {
  const parsed = profileSchema.safeParse({
    displayName: form.get('displayName'),
    locale: form.get('locale'),
  });
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        refusal: { reason: refusalKey(parsed.error.issues[0]?.message) },
      };
}
