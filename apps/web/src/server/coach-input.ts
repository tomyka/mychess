import {
  GROUP_NAME_ISSUES,
  groupNameSchema,
  INVITE_ISSUES,
  newInviteSchema,
  type NewInvite,
  type Result,
} from '@mychess/domain';

/** The catalogue key of every refusal a group name field can show. */
export type GroupNameIssue =
  (typeof GROUP_NAME_ISSUES)[keyof typeof GROUP_NAME_ISSUES];

/** The catalogue key of every refusal the invite form can show (R-110). */
export type InviteIssue = (typeof INVITE_ISSUES)[keyof typeof INVITE_ISSUES];

/** One of `keys` if `message` is one, else `fallback`. */
function issueKey<K extends string>(
  keys: readonly K[],
  message: string | undefined,
  fallback: K,
): K {
  return keys.find((key) => key === message) ?? fallback;
}

const GROUP_NAME_KEYS = Object.values(GROUP_NAME_ISSUES);
const INVITE_KEYS = Object.values(INVITE_ISSUES);

/** A form's `name` field as a group name (groupNameSchema); not text is blank. */
export function parseGroupName(
  form: FormData,
): Result<string, { readonly reason: GroupNameIssue }> {
  const raw = form.get('name');
  const parsed = groupNameSchema.safeParse(typeof raw === 'string' ? raw : '');
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = issueKey(
    GROUP_NAME_KEYS,
    parsed.error.issues[0]?.message,
    GROUP_NAME_ISSUES.blank,
  );
  return { ok: false, refusal: { reason } };
}

/** A missing or empty group field means no group. */
const groupField = (raw: FormDataEntryValue | null): unknown =>
  raw === null || raw === '' ? undefined : raw;

/** The invite form's kind and group, parsed with newInviteSchema (R-110). */
export function parseNewInvite(
  form: FormData,
): Result<NewInvite, { readonly reason: InviteIssue }> {
  const parsed = newInviteSchema.safeParse({
    kind: form.get('kind'),
    groupId: groupField(form.get('groupId')),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = issueKey(
    INVITE_KEYS,
    parsed.error.issues[0]?.message,
    INVITE_ISSUES.kindInvalid,
  );
  return { ok: false, refusal: { reason } };
}
