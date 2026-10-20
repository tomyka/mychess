// The coach's assign, unassign and deadline forms, parsed (CLAUDE.md: parse
// at the edges). A malformed id reads as the refusal a missing one gets, so
// a forged form learns nothing an honest one would not.
import {
  ASSIGNMENT_ISSUES,
  ASSIGNMENT_REFUSALS,
  deadlineSchema,
  type AssignmentRefusal,
  type Result,
} from '@mychess/domain';
import { z } from 'zod';
import { targetFromField } from '../lib/assign-target';
import { accountIdSchema } from './account-id';

/** The catalogue key for an assign form sent with nothing picked. */
export const ASSIGN_PICK_TARGET = 'assignment.panel.pickTarget';

/** Every catalogue key an assignment form can be refused with. */
export type AssignmentInputKey =
  | AssignmentRefusal['reason']
  | typeof ASSIGNMENT_ISSUES.deadlineInvalid
  | typeof ASSIGN_PICK_TARGET;

/** A deadline field: a calendar day, or empty for none. */
const optionalDeadline = z
  .union([deadlineSchema, z.literal('')])
  .transform((day) => (day === '' ? null : day));

export const assignInputSchema = z.object({
  repertoireId: z.uuid(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('player'), playerId: accountIdSchema }),
    z.object({ kind: z.literal('group'), groupId: z.uuid() }),
  ]),
  deadline: optionalDeadline,
});

export const assignmentIdSchema = z.object({ assignmentId: z.uuid() });

export const deadlineInputSchema = assignmentIdSchema.extend({
  deadline: optionalDeadline,
});

type Parsed<T> = Result<T, { readonly reason: AssignmentInputKey }>;

const refuse = <T>(reason: AssignmentInputKey): Parsed<T> => ({
  ok: false,
  refusal: { reason },
});

/**
 * The key the first issue reads as: the date says what is wrong with it; a
 * malformed group is not found and a malformed player not linked, as on
 * the coach dashboard; any other id is not found.
 */
function issueKey(error: z.ZodError): AssignmentInputKey {
  const [field, inner] = error.issues[0]?.path ?? [];
  if (field === 'deadline') return ASSIGNMENT_ISSUES.deadlineInvalid;
  if (field !== 'target') return ASSIGNMENT_REFUSALS.notFound;
  return inner === 'groupId'
    ? ASSIGNMENT_REFUSALS.groupNotFound
    : ASSIGNMENT_REFUSALS.notLinked;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): Parsed<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : refuse(issueKey(parsed.error));
}

/** A form field as text; a missing one is empty. */
const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

export type AssignInput = z.infer<typeof assignInputSchema>;

/** The assign form: the repertoire, the picked target and the deadline. */
export function parseAssignForm(form: FormData): Parsed<AssignInput> {
  const target = targetFromField(form.get('target'));
  if (target === undefined) return refuse(ASSIGN_PICK_TARGET);
  return parse(assignInputSchema, {
    repertoireId: text(form, 'repertoireId'),
    target,
    deadline: text(form, 'deadline'),
  });
}

/** An unassign form: which assignment. */
export function parseAssignmentRef(
  form: FormData,
): Parsed<z.infer<typeof assignmentIdSchema>> {
  return parse(assignmentIdSchema, {
    assignmentId: text(form, 'assignmentId'),
  });
}

/** A deadline form: which assignment and its new deadline (empty clears it). */
export function parseDeadlineForm(
  form: FormData,
): Parsed<z.infer<typeof deadlineInputSchema>> {
  return parse(deadlineInputSchema, {
    assignmentId: text(form, 'assignmentId'),
    deadline: text(form, 'deadline'),
  });
}
