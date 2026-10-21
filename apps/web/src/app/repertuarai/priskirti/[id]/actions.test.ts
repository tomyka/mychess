import { moveKey, START_KEY } from '@mychess/chess';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forkAction,
  markSeenAction,
  pauseAction,
  setPersonalNoteAction,
  type PauseState,
} from './actions';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const DB = { name: 'the db' };
const D4 = moveKey(START_KEY, 'd4');
const NOT_FOUND = { ok: false, refusal: { reason: 'assignment.notFound' } };

const server = vi.hoisted(() => ({
  pause: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  seen: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  setNote: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fork: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

/** The error the mocked `redirect` throws, naming where it sends. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock('@mychess/db', () => ({
  pauseAssignment: server.pause,
  markSeen: server.seen,
  setAssignedPersonalNote: server.setNote,
  forkAssignment: server.fork,
}));

vi.mock('../../../../server/db', () => ({ getDb: () => DB }));

// The session player; requireOnboarded's redirects are session.ts's own.
vi.mock('../../../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas', locale: 'lt' }),
}));

/** A form with `fields`. */
function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const RUNNING: PauseState = { paused: false };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-20T08:00:00Z'), toFake: ['Date'] });
  server.pause.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.seen.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.setNote.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.fork
    .mockReset()
    .mockResolvedValue({ ok: true, value: { forkId: 'f-1' } });
  return () => {
    vi.useRealTimers();
  };
});

describe('pauseAction (R-46)', () => {
  it('pauses the session player’s assignment, whatever player the form names', async () => {
    const state = await pauseAction(
      RUNNING,
      formOf({ repertoireId: ID, paused: 'true', playerId: 'gabija' }),
    );
    expect(state).toEqual({ paused: true });
    expect(server.pause).toHaveBeenCalledWith(
      DB,
      { playerId: 'rokas', repertoireId: ID, paused: true },
      new Date('2026-10-20T08:00:00Z'),
    );
  });

  it('resumes it', async () => {
    const state = await pauseAction(
      { paused: true },
      formOf({ repertoireId: ID, paused: 'false' }),
    );
    expect(state).toEqual({ paused: false });
    expect(server.pause).toHaveBeenCalledWith(
      DB,
      { playerId: 'rokas', repertoireId: ID, paused: false },
      expect.any(Date),
    );
  });

  it('keeps the state and says so when the assignment is not the player’s', async () => {
    server.pause.mockResolvedValue(NOT_FOUND);
    const state = await pauseAction(
      RUNNING,
      formOf({ repertoireId: ID, paused: 'true' }),
    );
    expect(state).toEqual({ paused: false, refusal: 'assignment.notFound' });
  });

  it('reads a malformed form as not found and writes nothing', async () => {
    for (const fields of [
      { repertoireId: 'not-a-uuid', paused: 'true' },
      { repertoireId: ID, paused: 'yes' },
      { repertoireId: ID },
      { paused: 'true' },
    ]) {
      const state = await pauseAction({ paused: true }, formOf(fields));
      expect(state).toEqual({ paused: true, refusal: 'assignment.notFound' });
    }
    expect(server.pause).not.toHaveBeenCalled();
  });
});

describe('forkAction (R-20, R-128)', () => {
  it('forks the session player’s assignment and goes to the copy', async () => {
    const sent = forkAction(
      {},
      formOf({ repertoireId: ID, playerId: 'gabija' }),
    );
    await expect(sent).rejects.toEqual(new Redirected('/repertuarai/f-1'));
    expect(server.fork).toHaveBeenCalledWith(
      DB,
      { playerId: 'rokas', repertoireId: ID },
      new Date('2026-10-20T08:00:00Z'),
    );
  });

  it('says so when it is not the player’s live assignment', async () => {
    server.fork.mockResolvedValue(NOT_FOUND);
    expect(await forkAction({}, formOf({ repertoireId: ID }))).toEqual({
      refusal: 'assignment.notFound',
    });
  });

  it('reads a malformed form as not assigned and writes nothing', async () => {
    for (const fields of [{ repertoireId: 'not-a-uuid' }, {}])
      expect(await forkAction({}, formOf(fields))).toEqual({
        refusal: 'assignment.notFound',
      });
    expect(server.fork).not.toHaveBeenCalled();
  });
});

describe('markSeenAction (R-133)', () => {
  it('marks the version the page showed seen, for the session player', async () => {
    await markSeenAction({
      repertoireId: ID,
      seenVersion: 4,
      playerId: 'gabija',
    });
    expect(server.seen).toHaveBeenCalledWith(DB, {
      playerId: 'rokas',
      repertoireId: ID,
      seenVersion: 4,
    });
  });

  it('marks version 0 too', async () => {
    await markSeenAction({ repertoireId: ID, seenVersion: 0 });
    expect(server.seen).toHaveBeenCalledWith(DB, {
      playerId: 'rokas',
      repertoireId: ID,
      seenVersion: 0,
    });
  });

  it('ignores a malformed request', async () => {
    for (const input of [
      { repertoireId: ID, seenVersion: -1 },
      { repertoireId: ID, seenVersion: 1.5 },
      { repertoireId: ID, seenVersion: '4' },
      { repertoireId: 'x', seenVersion: 4 },
      null,
    ])
      await markSeenAction(input);
    expect(server.seen).not.toHaveBeenCalled();
  });
});

describe('setPersonalNoteAction (R-21)', () => {
  const NOTE = { repertoireId: ID, moveKey: D4, text: '  Mano planas ' };

  it('saves the session player’s note on a move of their assigned repertoire', async () => {
    expect(
      await setPersonalNoteAction({ ...NOTE, playerId: 'gabija' }),
    ).toEqual({ ok: true });
    expect(server.setNote).toHaveBeenCalledWith(DB, {
      playerId: 'rokas',
      repertoireId: ID,
      moveKey: D4,
      text: 'Mano planas',
      now: new Date('2026-10-20T08:00:00Z'),
    });
  });

  it('removes the note with an empty text', async () => {
    expect(await setPersonalNoteAction({ ...NOTE, text: '' })).toEqual({
      ok: true,
    });
    expect(server.setNote).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ text: '' }),
    );
  });

  it('reads a malformed request as not assigned, writing nothing', async () => {
    expect(
      await setPersonalNoteAction({ ...NOTE, repertoireId: 'not-a-uuid' }),
    ).toEqual({ ok: false, refusal: 'assignment.notFound' });
    expect(server.setNote).not.toHaveBeenCalled();
  });

  it('says a note too long is too long, writing nothing', async () => {
    expect(
      await setPersonalNoteAction({ ...NOTE, text: 'x'.repeat(2001) }),
    ).toEqual({ ok: false, refusal: 'personalNote.tooLong' });
    expect(server.setNote).not.toHaveBeenCalled();
  });

  it('reads the write’s refusal as not assigned (not theirs, ended, or not one of its moves)', async () => {
    server.setNote.mockResolvedValue({
      ok: false,
      refusal: { reason: 'repertoire.notFound' },
    });
    expect(await setPersonalNoteAction(NOTE)).toEqual({
      ok: false,
      refusal: 'assignment.notFound',
    });
  });
});
