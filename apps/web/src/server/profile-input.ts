import {
  ACCOUNT_REFUSALS,
  DISPLAY_NAME_ISSUES,
  profileSchema,
  type Profile,
  type Result,
} from '@mychess/domain';
import { refusalOf } from './parse-refusal';

/** The catalogue key of every refusal a profile form can show. */
export type ProfileRefusalKey =
  | (typeof DISPLAY_NAME_ISSUES)[keyof typeof DISPLAY_NAME_ISSUES]
  | typeof ACCOUNT_REFUSALS.localeInvalid;

export interface ProfileRefusal {
  readonly reason: ProfileRefusalKey;
}

const KEYS: readonly ProfileRefusalKey[] = [
  ...Object.values(DISPLAY_NAME_ISSUES),
  ACCOUNT_REFUSALS.localeInvalid,
];

// The language refusal covers every locale issue; a name that is not text
// at all (missing, or a file) is the only other issue, and reads as blank.

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
        refusal: {
          reason: refusalOf(parsed.error, KEYS, DISPLAY_NAME_ISSUES.blank),
        },
      };
}
