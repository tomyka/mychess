import { describe, expect, it } from 'vitest';
import {
  ASSIGN_PICK_TARGET,
  assignInputSchema,
  deadlineInputSchema,
  parseAssignForm,
  parseAssignmentRef,
  parseDeadlineForm,
} from './assignment-input';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GROUP = '0b9e7a51-3c2d-4e6f-8a1b-2c3d4e5f6a7b';
const ASSIGNMENT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** A form with `fields`. */
function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

describe('assignInputSchema', () => {
  it('takes a player or a group target, and an empty deadline as none', () => {
    expect(
      assignInputSchema.parse({
        repertoireId: REPERTOIRE,
        target: { kind: 'player', playerId: 'rokas' },
        deadline: '',
      }),
    ).toEqual({
      repertoireId: REPERTOIRE,
      target: { kind: 'player', playerId: 'rokas' },
      deadline: null,
    });
    expect(
      assignInputSchema.parse({
        repertoireId: REPERTOIRE,
        target: { kind: 'group', groupId: GROUP },
        deadline: '2026-11-30',
      }).deadline,
    ).toBe('2026-11-30');
  });

  it('refuses a date that is not a calendar day', () => {
    expect(
      deadlineInputSchema.safeParse({
        assignmentId: ASSIGNMENT,
        deadline: '2026-02-30',
      }).success,
    ).toBe(false);
  });
});

describe('parseAssignForm', () => {
  const valid = {
    repertoireId: REPERTOIRE,
    target: 'player:rokas',
    deadline: '2026-11-30',
  };

  it('reads the repertoire, the picked target and the deadline', () => {
    expect(parseAssignForm(formOf(valid))).toEqual({
      ok: true,
      value: {
        repertoireId: REPERTOIRE,
        target: { kind: 'player', playerId: 'rokas' },
        deadline: '2026-11-30',
      },
    });
    expect(
      parseAssignForm(
        formOf({ ...valid, target: `group:${GROUP}`, deadline: '' }),
      ),
    ).toEqual({
      ok: true,
      value: {
        repertoireId: REPERTOIRE,
        target: { kind: 'group', groupId: GROUP },
        deadline: null,
      },
    });
  });

  it('reads a missing deadline field as none', () => {
    const form = formOf(valid);
    form.delete('deadline');
    const parsed = parseAssignForm(form);
    expect(parsed.ok && parsed.value.deadline).toBeNull();
  });

  it.each([
    ['nothing picked', { target: '' }, ASSIGN_PICK_TARGET],
    ['a malformed group', { target: 'group:nope' }, 'assignment.groupNotFound'],
    ['a malformed player', { target: 'player:' }, 'assignment.notLinked'],
    ['an unknown kind', { target: 'coach:jonas' }, 'assignment.notLinked'],
    ['a malformed repertoire', { repertoireId: 'x' }, 'assignment.notFound'],
    ['a bad date', { deadline: '30.11.2026' }, 'assignment.deadlineInvalid'],
  ])('refuses %s with its key', (_name, change, reason) => {
    expect(parseAssignForm(formOf({ ...valid, ...change }))).toEqual({
      ok: false,
      refusal: { reason },
    });
  });

  it('refuses a missing target field as nothing picked', () => {
    const form = formOf(valid);
    form.delete('target');
    expect(parseAssignForm(form)).toEqual({
      ok: false,
      refusal: { reason: ASSIGN_PICK_TARGET },
    });
  });
});

describe('parseAssignmentRef', () => {
  it('reads the assignment id', () => {
    expect(parseAssignmentRef(formOf({ assignmentId: ASSIGNMENT }))).toEqual({
      ok: true,
      value: { assignmentId: ASSIGNMENT },
    });
  });

  it('refuses a malformed one as not found', () => {
    expect(parseAssignmentRef(formOf({ assignmentId: '1' }))).toEqual({
      ok: false,
      refusal: { reason: 'assignment.notFound' },
    });
    expect(parseAssignmentRef(new FormData())).toEqual({
      ok: false,
      refusal: { reason: 'assignment.notFound' },
    });
  });
});

describe('parseDeadlineForm', () => {
  it('reads a new deadline, or an empty one as cleared', () => {
    expect(
      parseDeadlineForm(
        formOf({ assignmentId: ASSIGNMENT, deadline: '2026-12-01' }),
      ),
    ).toEqual({
      ok: true,
      value: { assignmentId: ASSIGNMENT, deadline: '2026-12-01' },
    });
    expect(
      parseDeadlineForm(formOf({ assignmentId: ASSIGNMENT, deadline: '' })),
    ).toEqual({
      ok: true,
      value: { assignmentId: ASSIGNMENT, deadline: null },
    });
  });

  it('refuses a bad date, and a malformed assignment as not found', () => {
    expect(
      parseDeadlineForm(formOf({ assignmentId: ASSIGNMENT, deadline: 'soon' })),
    ).toEqual({
      ok: false,
      refusal: { reason: 'assignment.deadlineInvalid' },
    });
    expect(
      parseDeadlineForm(formOf({ assignmentId: 'x', deadline: '' })),
    ).toEqual({ ok: false, refusal: { reason: 'assignment.notFound' } });
  });
});
