import {
  DISPLAY_NAME_ISSUES,
  profileSchema,
  type Profile,
  type Result,
} from '@mychess/domain';
import { refusalOf } from './parse-refusal';

/** The catalogue key of every refusal a profile form can show. */
export type ProfileRefusalKey =
  (typeof DISPLAY_NAME_ISSUES)[keyof typeof DISPLAY_NAME_ISSUES];

export interface ProfileRefusal {
  readonly reason: ProfileRefusalKey;
}

const KEYS: readonly ProfileRefusalKey[] = Object.values(DISPLAY_NAME_ISSUES);

/**
 * The display name from a form, parsed at the edge. A name that is not text
 * at all (missing, or a file) reads as blank.
 */
export function parseProfileInput(
  form: FormData,
): Result<Profile, ProfileRefusal> {
  const parsed = profileSchema.safeParse({
    displayName: form.get('displayName'),
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
