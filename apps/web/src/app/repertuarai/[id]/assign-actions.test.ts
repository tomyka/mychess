import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assignAction,
  clearDeadlineAction,
  setDeadlineAction,
  unassignAction,
  type AssignmentActionState,
} from './assign-actions';

const REPERTOIRE = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const ASSIGNMENT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');
const DONE = { ok: true, value: undefined };

const server = vi.hoisted(() => ({
  assign: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  unassign: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setDeadline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  refresh: vi.fn<() => void>(),
}));

vi.mock('@mychess/db', () => ({
  assign: server.assign,
  unassign: server.unassign,
  setDeadline: server.setDeadline,
}));

vi.mock('next/cache', () => ({ refresh: server.refresh }));

vi.mock('../../../server/db', () => ({ getDb: () => DB }));

// The session coach; requireCoach's redirects are coaching.ts's own.
vi.mock('../../../server/coaching', () => ({
  requireCoach: () => Promise.resolve({ id: 'jonas' }),
}));

/** A form with `fields`. */
function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const FRESH: AssignmentActionState = {};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.assign.mockReset().mockResolvedValue(DONE);
  server.unassign.mockReset().mockResolvedValue(DONE);
  server.setDeadline.mockReset().mockResolvedValue(DONE);
  server.refresh.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('assignAction (R-15, R-16)', () => {
  it('assigns as the session coach, whatever coach the form names', async () => {
    const state = await assignAction(
      FRESH,
      formOf({
        repertoireId: REPERTOIRE,
        target: 'player:rokas',
        deadline: '2026-11-30',
        coachId: 'someone-else',
      }),
    );
    expect(server.assign).toHaveBeenCalledWith(
      DB,
      {
        coachId: 'jonas',
        repertoireId: REPERTOIRE,
        target: { kind: 'player', playerId: 'rokas' },
        deadline: '2026-11-30',
      },
      NOW,
    );
    expect(state).toEqual({ saved: 1 });
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('counts each assignment made, so the form can start afresh', async () => {
    expect(
      await assignAction(
        { saved: 2 },
        formOf({ repertoireId: REPERTOIRE, target: 'player:rokas' }),
      ),
    ).toEqual({ saved: 3 });
  });

  it('refuses malformed input without asking the database', async () => {
    expect(
      await assignAction(
        FRESH,
        formOf({ repertoireId: REPERTOIRE, target: '', deadline: '' }),
      ),
    ).toEqual({ refusal: 'assignment.panel.pickTarget' });
    expect(server.assign).not.toHaveBeenCalled();
    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal', async () => {
    server.assign.mockResolvedValue({
      ok: false,
      refusal: { reason: 'assignment.notLinked' },
    });
    expect(
      await assignAction(
        { saved: 1 },
        formOf({ repertoireId: REPERTOIRE, target: 'player:marta' }),
      ),
    ).toEqual({ refusal: 'assignment.notLinked' });
    expect(server.refresh).not.toHaveBeenCalled();
  });
});

describe('unassignAction (R-130)', () => {
  it('ends the session coach’s assignment', async () => {
    expect(
      await unassignAction(FRESH, formOf({ assignmentId: ASSIGNMENT })),
    ).toEqual({ saved: 1 });
    expect(server.unassign).toHaveBeenCalledWith(
      DB,
      { coachId: 'jonas', assignmentId: ASSIGNMENT },
      NOW,
    );
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed id as not found', async () => {
    expect(await unassignAction(FRESH, formOf({ assignmentId: '1' }))).toEqual({
      refusal: 'assignment.notFound',
    });
    expect(server.unassign).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal', async () => {
    server.unassign.mockResolvedValue({
      ok: false,
      refusal: { reason: 'assignment.notFound' },
    });
    expect(
      await unassignAction(FRESH, formOf({ assignmentId: ASSIGNMENT })),
    ).toEqual({ refusal: 'assignment.notFound' });
  });
});

describe('setDeadlineAction (R-51)', () => {
  it('moves the session coach’s deadline', async () => {
    expect(
      await setDeadlineAction(
        FRESH,
        formOf({ assignmentId: ASSIGNMENT, deadline: '2026-12-15' }),
      ),
    ).toEqual({ saved: 1 });
    expect(server.setDeadline).toHaveBeenCalledWith(DB, {
      coachId: 'jonas',
      assignmentId: ASSIGNMENT,
      deadline: '2026-12-15',
    });
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty date: clearing is its own action', async () => {
    expect(
      await setDeadlineAction(
        FRESH,
        formOf({ assignmentId: ASSIGNMENT, deadline: '' }),
      ),
    ).toEqual({ refusal: 'assignment.deadlineInvalid' });
    expect(server.setDeadline).not.toHaveBeenCalled();
  });

  it('refuses a bad date without asking the database', async () => {
    expect(
      await setDeadlineAction(
        FRESH,
        formOf({ assignmentId: ASSIGNMENT, deadline: '2026-13-01' }),
      ),
    ).toEqual({ refusal: 'assignment.deadlineInvalid' });
    expect(server.setDeadline).not.toHaveBeenCalled();
  });
});

describe('clearDeadlineAction (R-51)', () => {
  it('clears the session coach’s deadline, whatever date the form sends', async () => {
    expect(
      await clearDeadlineAction(
        FRESH,
        formOf({ assignmentId: ASSIGNMENT, deadline: '2026-12-15' }),
      ),
    ).toEqual({ saved: 1 });
    expect(server.setDeadline).toHaveBeenCalledWith(DB, {
      coachId: 'jonas',
      assignmentId: ASSIGNMENT,
      deadline: null,
    });
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed id as not found', async () => {
    expect(
      await clearDeadlineAction(FRESH, formOf({ assignmentId: 'x' })),
    ).toEqual({ refusal: 'assignment.notFound' });
    expect(server.setDeadline).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal', async () => {
    server.setDeadline.mockResolvedValue({
      ok: false,
      refusal: { reason: 'assignment.notCoach' },
    });
    expect(
      await clearDeadlineAction(FRESH, formOf({ assignmentId: ASSIGNMENT })),
    ).toEqual({ refusal: 'assignment.notCoach' });
  });
});
