import {
  ecoName,
  importPgn,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import {
  assign,
  forkAssignment,
  leaveGroup,
  loadRepertoire,
  pauseAssignment,
  shareRepertoire,
  unassign,
  unlink,
} from '@mychess/db';
import type { AssignmentTarget } from '@mychess/domain';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GET } from '../../src/app/api/repertoires/[id]/export/route';
import { contentDisposition } from '../../src/server/pgn-download';
import {
  actAs,
  coachPerson,
  groupOf,
  link,
  person,
  type Person,
} from './support/coaching';
import { useRequestHarness } from './support/harness';
import { request, testDb } from './support/request';
import {
  ecoOf,
  LONDON,
  seedRepertoire,
  UNTITLED_TAIMANOV,
} from './support/repertoires';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

interface Cast {
  readonly rokas: Person;
  readonly rimantas: Person;
  /** Rokas's Taimanov. */
  readonly taimanov: string;
}

async function cast(): Promise<Cast> {
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const rimantas = await person(sql, 'rimantas@example.lt', 'Rimantas');
  const taimanov = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: UNTITLED_TAIMANOV,
    side: 'black',
    name: 'Sicilijos gynyba, Taimanovo variantas',
  });
  return { rokas, rimantas, taimanov };
}

const download = (id: string): Promise<Response> =>
  GET(new Request(`http://localhost/api/repertoires/${id}/export`), {
    params: Promise.resolve({ id }),
  });

// The tree as the export round trip must keep it (export-pgn.test.ts).
const canonical = (graph: RepertoireGraph): string[] => {
  const ids = graph.chapters.map((c) => c.id);
  return graph.moves
    .map((m) =>
      JSON.stringify([
        m.from,
        m.san,
        m.arrows,
        m.circles,
        m.comment,
        m.chapters.map((c) => ids.indexOf(c)).sort(),
      ]),
    )
    .sort();
};

async function storedGraph(
  id: string,
  ownerId: string,
): Promise<RepertoireGraph> {
  const loaded = await loadRepertoire(testDb(), id, ownerId);
  if (loaded === undefined) throw new Error('no repertoire');
  return loaded.graph;
}

/** The downloaded body imported again, as `canonical`; nothing may be skipped. */
async function reimported(response: Response, side: Side): Promise<string[]> {
  const again = importPgn(await response.text(), side);
  if (!again.ok) throw new Error(again.refusal.reason);
  expect(again.value.skipped).toEqual([]);
  return canonical(again.value.graph);
}

describe('the PGN download (R-96, decision 13)', () => {
  it('answers 401 without a session, cached nowhere', async () => {
    const { taimanov } = await cast();
    request.cookie = '';
    const response = await download(taimanov);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('answers the same 404 for another account’s, a missing and a malformed id', async () => {
    const { rimantas, taimanov } = await cast();
    actAs(rimantas);
    for (const id of [taimanov, crypto.randomUUID(), 'not-a-uuid']) {
      const response = await download(id);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(await response.text()).toBe('');
    }
  });

  it('downloads the owner’s repertoire as PGN that re-imports to the stored tree (G-M1-6)', async () => {
    const { rokas, taimanov } = await cast();
    actAs(rokas);
    const response = await download(taimanov);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe(
      'application/x-chess-pgn; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      contentDisposition('Sicilijos gynyba, Taimanovo variantas'),
    );
    const stored = await storedGraph(taimanov, rokas.id);
    expect(await reimported(response, 'black')).toEqual(canonical(stored));
    expect(canonical(stored).join()).toContain('The main line');
  });

  it('keeps arrows, comments and shared chapters through the round trip', async () => {
    const { rokas } = await cast();
    const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: 'Londono sistema',
    });
    actAs(rokas);
    const stored = await storedGraph(london, rokas.id);
    expect(stored.moves.some((m) => m.arrows.length > 0)).toBe(true);
    expect(stored.moves.some((m) => m.chapters.length > 1)).toBe(true);
    expect(await reimported(await download(london), 'white')).toEqual(
      canonical(stored),
    );
  });

  it('titles the chapters by their opening names (decision 14)', async () => {
    const { rokas, taimanov } = await cast();
    actAs(rokas);
    const eco = ecoOf(
      (await storedGraph(taimanov, rokas.id)).chapters[0]?.nameSource,
    );
    expect(ecoName(eco)).toMatch(/^Sicilian Defense/u);
    const pgn = await (await download(taimanov)).text();
    expect(pgn).toContain(`[Event "${ecoName(eco)}"]`);
  });

  it('falls back to a safe file name when the name has no letters or digits', async () => {
    const { rokas } = await cast();
    const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
      pgn: LONDON,
      side: 'white',
      name: '???',
    });
    actAs(rokas);
    const response = await download(london);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="repertoire.pgn"; filename*=UTF-8\'\'%3F%3F%3F.pgn',
    );
  });
});

interface CoachCast {
  /** Coach; Rokas is in his group, Gabija is linked to him alone. */
  readonly rimantas: Person;
  readonly rokas: Person;
  readonly gabija: Person;
  /** Rimantas's London, with his comments, assigned to Rokas alone. */
  readonly london: string;
  /** Rimantas's Taimanov, assigned to the group. */
  readonly taimanov: string;
  /** Gabija's own London, shared with Rimantas. */
  readonly gabijas: string;
  /** Rimantas's "Šeštadienio grupė", Rokas in it. */
  readonly group: string;
}

async function assignTo(
  coachId: string,
  repertoireId: string,
  target: AssignmentTarget,
): Promise<void> {
  const done = await assign(
    testDb(),
    { coachId, repertoireId, target, deadline: null },
    new Date(),
  );
  if (!done.ok) throw new Error(`not assigned: ${done.refusal.reason}`);
}

async function coachCast(): Promise<CoachCast> {
  const rimantas = await coachPerson(sql, 'rimantas@example.lt', 'Rimantas');
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  const group = await groupOf(rimantas.id, 'Šeštadienio grupė');
  await link(rimantas.id, rokas.id, group);
  await link(rimantas.id, gabija.id);
  const london = await seedRepertoire(testDb(), 'rimantas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  const taimanov = await seedRepertoire(testDb(), 'rimantas@example.lt', {
    pgn: UNTITLED_TAIMANOV,
    side: 'black',
    name: 'Taimanovas',
  });
  await assignTo(rimantas.id, london, { kind: 'player', playerId: rokas.id });
  await assignTo(rimantas.id, taimanov, { kind: 'group', groupId: group });
  const gabijas = await seedRepertoire(testDb(), 'gabija@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Gabijos Londonas',
  });
  const shared = await shareRepertoire(testDb(), {
    ownerId: gabija.id,
    repertoireId: gabijas,
    coachId: rimantas.id,
    now: new Date(),
  });
  if (!shared.ok) throw new Error(`not shared: ${shared.refusal.reason}`);
  return { rimantas, rokas, gabija, london, taimanov, gabijas, group };
}

/** The id of the assignment of `repertoireId` straight to `playerId`. */
async function assignmentId(
  repertoireId: string,
  playerId: string,
): Promise<string> {
  const [row] = z
    .tuple([z.object({ id: z.string().min(1) })])
    .parse(
      await sql.rows(
        'select id from assignments where repertoire_id = $1 and player_id = $2',
        [repertoireId, playerId],
      ),
    );
  return row.id;
}

/** What a refused download shows: the status, the headers that matter and the body. */
async function answerOf(response: Response): Promise<unknown> {
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    disposition: response.headers.get('content-disposition'),
    body: await response.text(),
  };
}

/** The one answer to anything the account may not download (decision 12). */
const EMPTY_404 = {
  status: 404,
  cache: 'no-store',
  disposition: null,
  body: '',
};

describe('the PGN download of an assigned repertoire (R-202)', () => {
  it('downloads the coach’s moves and comments for the player it is assigned to', async () => {
    const { rimantas, rokas, london } = await coachCast();
    actAs(rokas);
    const response = await download(london);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe(
      'application/x-chess-pgn; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      contentDisposition('Londono sistema'),
    );
    const stored = await storedGraph(london, rimantas.id);
    expect(canonical(stored).join()).toContain('Solid');
    expect(await reimported(response, 'white')).toEqual(canonical(stored));
  });

  it('downloads one assigned through the player’s group', async () => {
    const { rimantas, rokas, taimanov } = await coachCast();
    actAs(rokas);
    const response = await download(taimanov);
    expect(response.status).toBe(200);
    expect(await reimported(response, 'black')).toEqual(
      canonical(await storedGraph(taimanov, rimantas.id)),
    );
  });

  it('answers the empty 404 to a linked player it is not assigned to', async () => {
    const { gabija, london } = await coachCast();
    actAs(gabija);
    expect(await answerOf(await download(london))).toEqual(EMPTY_404);
  });

  it('answers the empty 404 once the player forked it (R-128)', async () => {
    const { rokas, london } = await coachCast();
    const forked = await forkAssignment(
      testDb(),
      { playerId: rokas.id, repertoireId: london },
      new Date(),
    );
    if (!forked.ok) throw new Error(`not forked: ${forked.refusal.reason}`);
    actAs(rokas);
    expect(await answerOf(await download(london))).toEqual(EMPTY_404);
    expect((await download(forked.value.forkId)).status).toBe(200);
  });

  it('answers the empty 404 for both once the coach and the player are unlinked (R-44)', async () => {
    const { rimantas, rokas, london, taimanov } = await coachCast();
    const done = await unlink(testDb(), rimantas.id, rokas.id, new Date());
    if (!done.ok) throw new Error(`not unlinked: ${done.refusal.reason}`);
    actAs(rokas);
    expect(await answerOf(await download(london))).toEqual(EMPTY_404);
    expect(await answerOf(await download(taimanov))).toEqual(EMPTY_404);
  });

  it('answers the empty 404 for the group’s once the player leaves the group, and still downloads their own assignment', async () => {
    const { rokas, london, taimanov, group } = await coachCast();
    const left = await leaveGroup(testDb(), rokas.id, group, new Date());
    if (!left.ok) throw new Error(`not left: ${left.refusal.reason}`);
    actAs(rokas);
    expect(await answerOf(await download(taimanov))).toEqual(EMPTY_404);
    expect((await download(london)).status).toBe(200);
  });

  it('answers the empty 404 once the coach unassigns it (R-130)', async () => {
    const { rimantas, rokas, london } = await coachCast();
    const done = await unassign(
      testDb(),
      {
        coachId: rimantas.id,
        assignmentId: await assignmentId(london, rokas.id),
      },
      new Date(),
    );
    if (!done.ok) throw new Error(`not unassigned: ${done.refusal.reason}`);
    actAs(rokas);
    expect(await answerOf(await download(london))).toEqual(EMPTY_404);
  });

  it('still downloads a paused assignment (R-46: paused stays assigned)', async () => {
    const { rokas, london } = await coachCast();
    const paused = await pauseAssignment(
      testDb(),
      { playerId: rokas.id, repertoireId: london, paused: true },
      new Date(),
    );
    if (!paused.ok) throw new Error(`not paused: ${paused.refusal.reason}`);
    actAs(rokas);
    expect((await download(london)).status).toBe(200);
  });

  it('answers the empty 404 to a coach for a repertoire only shared with them', async () => {
    const { rimantas, gabijas } = await coachCast();
    actAs(rimantas);
    expect(await answerOf(await download(gabijas))).toEqual(EMPTY_404);
  });
});
