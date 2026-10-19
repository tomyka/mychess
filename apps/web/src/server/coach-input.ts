import {
  ACCESS_REFUSALS,
  COACH_NOTE_ISSUES,
  COACH_NOTE_REFUSALS,
  coachNoteSchema,
  GROUP_NAME_ISSUES,
  groupNameSchema,
  INVITE_ISSUES,
  newInviteSchema,
  type AccessRefusal,
  type CoachNoteRefusal,
  type NewInvite,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';
import { accountIdSchema } from './account-id';

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

/** The catalogue key of every refusal a coach note can come to. */
export type CoachNoteRefusalKey =
  | AccessRefusal['reason']
  | CoachNoteRefusal['reason']
  | (typeof COACH_NOTE_ISSUES)[keyof typeof COACH_NOTE_ISSUES];

/** Which coach note is meant: the player's repertoire and the move. */
export interface CoachNoteMove {
  readonly playerId: string;
  readonly repertoireId: string;
  readonly moveKey: string;
}

/** A coach note to write. */
export interface CoachNoteRequest extends CoachNoteMove {
  readonly text: string;
}

type CoachNoteParse<T> = Result<T, { readonly reason: CoachNoteRefusalKey }>;

const coachNoteTargetSchema = z.object({
  playerId: accountIdSchema,
  repertoireId: z.uuid(),
  // A position key (a FEN without the move counters) and a SAN.
  moveKey: z.string().min(1).max(120),
});

const coachNoteRequestSchema = coachNoteTargetSchema.extend({
  text: coachNoteSchema,
});

const COACH_NOTE_KEYS = Object.values(COACH_NOTE_ISSUES);

/**
 * What a malformed field reads as: a player is not linked, a repertoire
 * not shared and a move not found, as an id that does not exist would; the
 * text says what is wrong with it.
 */
function coachNoteIssue(error: z.ZodError): CoachNoteRefusalKey {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (field === 'text')
    return issueKey(COACH_NOTE_KEYS, issue?.message, COACH_NOTE_ISSUES.blank);
  if (field === 'playerId') return ACCESS_REFUSALS.notLinked;
  if (field === 'moveKey') return COACH_NOTE_REFUSALS.moveNotFound;
  return ACCESS_REFUSALS.notShared;
}

/** `schema`'s parse of `input`, or the refusal its first issue reads as. */
function parseNote<T>(schema: z.ZodType<T>, input: unknown): CoachNoteParse<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, refusal: { reason: coachNoteIssue(parsed.error) } };
}

/** A coach note's player, repertoire and move from a client. */
export function parseCoachNoteMove(
  input: unknown,
): CoachNoteParse<CoachNoteMove> {
  return parseNote(coachNoteTargetSchema, input);
}

/** A coach note from a client: its target and its text (coachNoteSchema). */
export function parseCoachNote(
  input: unknown,
): CoachNoteParse<CoachNoteRequest> {
  return parseNote(coachNoteRequestSchema, input);
}
