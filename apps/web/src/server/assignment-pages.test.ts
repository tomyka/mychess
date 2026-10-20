import type { AssignedRepertoire, ChangesSince } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../test/fixtures/repertoires';
import { assignedRepertoireData } from './assignment-pages';
import { ecoNamesOf } from './chapter-names';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');

/** The error the mocked `notFound` throws. */
class NotFound extends Error {}

const server = vi.hoisted(() => ({
  assigned:
    vi.fn<(db: unknown, playerId: string, id: string) => Promise<unknown>>(),
  changes: vi.fn<(db: unknown, request: unknown) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  assignedRepertoireForPlayer: server.assigned,
  changesSince: server.changes,
}));

vi.mock('./db', () => ({ getDb: () => DB }));

// The session player; requireOnboarded's redirects are session.ts's own.
vi.mock('./session', () => ({
  requireOnboarded: () =>
    Promise.resolve({ id: 'rokas', locale: 'en', displayName: 'Rokas' }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

const GRAPH = graphOf(LONDON);

/** Rokas's London as his coach Jonas assigned it, with Rokas's note. */
const ASSIGNED: AssignedRepertoire = {
  repertoire: {
    id: ID,
    ownerId: 'jonas',
    side: 'white',
    name: 'Londono sistema',
    version: 4,
    createdAt: NOW,
    updatedAt: NOW,
  },
  graph: GRAPH,
  coachName: 'Jonas',
  personalNotes: { 'k|d4': 'Mano planas' },
  paused: true,
};

const CHANGES: ChangesSince = {
  changes: {
    added: [{ moveKey: 'k|d4', chapterId: 'c1' }],
    removed: [],
    annotated: 2,
  },
};

beforeEach(() => {
  server.assigned.mockReset().mockResolvedValue(ASSIGNED);
  server.changes.mockReset().mockResolvedValue(CHANGES);
});

describe('assignedRepertoireData', () => {
  it('loads the repertoire for the session player, with what changed since their last visit', async () => {
    const data = await assignedRepertoireData(ID);
    expect(server.assigned).toHaveBeenCalledWith(DB, 'rokas', ID);
    // Only the changes up to the version shown: they match the graph.
    expect(server.changes).toHaveBeenCalledWith(DB, {
      playerId: 'rokas',
      repertoireId: ID,
      upToVersion: 4,
    });
    expect(data).toEqual({
      repertoire: {
        id: ID,
        name: 'Londono sistema',
        side: 'white',
        version: 4,
      },
      coachName: 'Jonas',
      graph: GRAPH,
      personalNotes: { 'k|d4': 'Mano planas' },
      paused: true,
      // In the player's own language.
      ecoNames: ecoNamesOf(GRAPH, 'en'),
      changes: CHANGES.changes,
    });
  });

  it('is 404 for an id that is not a uuid, before reading anything', async () => {
    for (const raw of ['not-a-uuid', '', undefined, 42])
      await expect(assignedRepertoireData(raw)).rejects.toBeInstanceOf(
        NotFound,
      );
    expect(server.assigned).not.toHaveBeenCalled();
  });

  it('is 404 when the repertoire is not assigned to the session player now', async () => {
    server.assigned.mockResolvedValue(undefined);
    await expect(assignedRepertoireData(ID)).rejects.toBeInstanceOf(NotFound);
  });

  it('is 404 when the assignment ended between the two reads', async () => {
    server.changes.mockResolvedValue(undefined);
    await expect(assignedRepertoireData(ID)).rejects.toBeInstanceOf(NotFound);
  });
});
