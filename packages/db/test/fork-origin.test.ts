/**
 * What a fork records of where it came from (#328): every fork path writes
 * the source repertoire and the coach's display name, the player's list
 * reads them, migration 0020 backfills older forks, and the coach progress
 * read names a forked assignment's fork only when the player shares it with
 * that coach (R-39, R-42, R-43).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptForkOffer,
  assign,
  coachGroupPage,
  coachPlayerProgress,
  deleteAccount,
  deleteRepertoire,
  forkAssignment,
  listRepertoires,
  openForkOffers,
  shareRepertoire,
  unassign,
  unlink,
  unshareRepertoire,
} from '../src';
import { progressRepertoire } from '@mychess/domain';
import { assignments } from '../src/assignment-schema';
import { MIGRATIONS_FOLDER } from '../src/migrations';
import { coachProgressFacts } from '../src/progress/facts';
import { sharedPairs } from '../src/share-scope';
import { useTestDatabase } from '../src/testing';
import { seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
const OK = { ok: true, value: undefined };

const BACKFILL = '0020_backfill_fork_origins.sql';

let rep = '';
let group = '';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function succeeded(
  done: { ok: true } | { ok: false; refusal: { reason: string } },
): void {
  if (!done.ok) throw new Error(done.refusal.reason);
}

interface StoredOrigin {
  readonly id: string;
  readonly forked_from_repertoire_id: string | null;
  readonly forked_from_coach_name: string | null;
}

/** The fork columns of every repertoire `ownerId` owns, oldest first. */
async function originsOf(ownerId: string): Promise<StoredOrigin[]> {
  const { rows } = await client.query<StoredOrigin>(
    `select id, forked_from_repertoire_id, forked_from_coach_name
     from repertoires where owner_account_id = $1 order by created_at, id`,
    [ownerId],
  );
  return rows;
}

async function assignTo(playerId: string): Promise<void> {
  expect(
    await assign(
      db,
      {
        coachId: 'c',
        repertoireId: rep,
        target: { kind: 'player', playerId },
        deadline: null,
      },
      NOW,
    ),
  ).toEqual(OK);
}

async function fork(playerId: string, repertoireId = rep): Promise<string> {
  const forked = await forkAssignment(db, { playerId, repertoireId }, LATER);
  if (!forked.ok) throw new Error(forked.refusal.reason);
  return forked.value.forkId;
}

/** Ends `playerId`'s individual assignment, so they get a fork offer. */
async function unassignFrom(playerId: string): Promise<void> {
  const rows = await db.select().from(assignments);
  const row = must(rows.find((one) => one.playerId === playerId));
  expect(
    await unassign(db, { coachId: 'c', assignmentId: row.id }, NOW),
  ).toEqual(OK);
}

async function acceptOffer(playerId: string): Promise<string> {
  const [offer] = await openForkOffers(db, playerId, NOW);
  const accepted = await acceptForkOffer(
    db,
    { playerId, offerId: must(offer).id },
    LATER,
  );
  if (!accepted.ok) throw new Error(accepted.refusal.reason);
  return accepted.value.forkId;
}

async function share(
  ownerId: string,
  repertoireId: string,
  coachId: string,
): Promise<void> {
  succeeded(
    await shareRepertoire(db, { ownerId, repertoireId, coachId, now: NOW }),
  );
}

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedCoach(db, 'c2', 'c2@example.lt');
  await seedPlayer(db, 'p', 'p@example.lt');
  await seedPlayer(db, 'q', 'q@example.lt');
  for (const id of ['p', 'q']) {
    await seedLink(db, 'c', id);
    await seedLink(db, 'c2', id);
  }
  rep = await seedRepertoire(db, 'c', NOW);
});

describe('every fork records its source and coach (#328)', () => {
  it('a fork the player asks for (R-20, R-128)', async () => {
    await assignTo('p');
    const forkId = await fork('p');
    expect(await originsOf('p')).toEqual([
      {
        id: forkId,
        forked_from_repertoire_id: rep,
        forked_from_coach_name: 'Name c',
      },
    ]);
  });

  it('an accepted fork offer (R-44, R-130)', async () => {
    await assignTo('p');
    await unassignFrom('p');
    const forkId = await acceptOffer('p');
    expect(await originsOf('p')).toEqual([
      {
        id: forkId,
        forked_from_repertoire_id: rep,
        forked_from_coach_name: 'Name c',
      },
    ]);
  });

  it('an offer accepted after the coach deleted the repertoire keeps the coach only (R-131)', async () => {
    await assignTo('p');
    expect(await deleteRepertoire(db, rep, 'c', NOW)).toEqual(OK);
    const forkId = await acceptOffer('p');
    expect(await originsOf('p')).toEqual([
      {
        id: forkId,
        forked_from_repertoire_id: null,
        forked_from_coach_name: 'Name c',
      },
    ]);
  });

  it("the automatic fork of a deleting coach keeps the coach's name past the cascade (R-49, R-137, R-163)", async () => {
    await assignTo('p');
    await deleteAccount(db, 'c', LATER);
    const [one] = await originsOf('p');
    expect(one).toMatchObject({
      forked_from_repertoire_id: null,
      forked_from_coach_name: 'Name c',
    });
  });

  it('records nothing on a repertoire the player makes', async () => {
    await seedRepertoire(db, 'p', NOW);
    expect(await originsOf('p')).toMatchObject([
      { forked_from_repertoire_id: null, forked_from_coach_name: null },
    ]);
  });

  it('keeps the coach name when the coach deletes the source repertoire', async () => {
    await assignTo('p');
    const forkId = await fork('p');
    expect(await deleteRepertoire(db, rep, 'c', NOW)).toEqual(OK);
    expect(await originsOf('p')).toEqual([
      {
        id: forkId,
        forked_from_repertoire_id: null,
        forked_from_coach_name: 'Name c',
      },
    ]);
  });

  it('refuses a source without a coach name', async () => {
    await expect(
      client.query(
        `update repertoires set forked_from_repertoire_id = $1 where owner_account_id = 'c'`,
        [rep],
      ),
    ).rejects.toThrow(/repertoires_fork_origin_check/);
  });
});

describe('listRepertoires (#328)', () => {
  it("gives a fork its origin, the player's own repertoire none", async () => {
    const own = await seedRepertoire(db, 'p', NOW);
    await assignTo('p');
    const forkId = await fork('p');
    const listed = await listRepertoires(db, 'p');
    expect(listed.map((one) => [one.id, one.forkedFrom])).toEqual([
      [own, null],
      [forkId, { repertoireId: rep, coachName: 'Name c' }],
    ]);
  });
});

describe(`migration ${BACKFILL}`, () => {
  const backfill = () =>
    client.query(readFileSync(join(MIGRATIONS_FOLDER, BACKFILL), 'utf8'));

  const forget = () =>
    client.query(
      'update repertoires set forked_from_repertoire_id = null, forked_from_coach_name = null',
    );

  it("restores an accepted offer's fork from the offer, a forked assignment's from its timestamp, twice over", async () => {
    await assignTo('p');
    await unassignFrom('p');
    const fromOffer = await acceptOffer('p');
    await assignTo('q');
    const fromAssignment = await fork('q');
    const own = await seedRepertoire(db, 'q', NOW);
    const before = [...(await originsOf('p')), ...(await originsOf('q'))];
    await forget();
    await backfill();
    await backfill();
    const after = [...(await originsOf('p')), ...(await originsOf('q'))];
    expect(after).toEqual(before);
    const origin = {
      forked_from_repertoire_id: rep,
      forked_from_coach_name: 'Name c',
    };
    expect(after).toEqual([
      { id: fromOffer, ...origin },
      {
        id: own,
        forked_from_repertoire_id: null,
        forked_from_coach_name: null,
      },
      { id: fromAssignment, ...origin },
    ]);
  });

  it("keeps an accepted offer's coach when its source is gone", async () => {
    await assignTo('p');
    expect(await deleteRepertoire(db, rep, 'c', NOW)).toEqual(OK);
    await acceptOffer('p');
    await forget();
    await backfill();
    expect(await originsOf('p')).toMatchObject([
      { forked_from_repertoire_id: null, forked_from_coach_name: 'Name c' },
    ]);
  });

  it("labels a deleted coach's automatic fork from its coach notes, with no source, and a re-run changes nothing", async () => {
    await assignTo('p');
    await deleteAccount(db, 'c', LATER);
    await forget();
    await backfill();
    expect(await originsOf('p')).toMatchObject([
      { forked_from_repertoire_id: null, forked_from_coach_name: 'Name c' },
    ]);
    await client.query(
      "update repertoires set forked_from_coach_name = 'Kitas' where owner_account_id = 'p'",
    );
    await backfill();
    expect(await originsOf('p')).toMatchObject([
      { forked_from_repertoire_id: null, forked_from_coach_name: 'Kitas' },
    ]);
  });

  it('leaves a fork whose coach notes carry two names unlabelled', async () => {
    await assignTo('p');
    await deleteAccount(db, 'c', LATER);
    const [one] = await originsOf('p');
    await client.query(
      `insert into fork_coach_notes (repertoire_id, move_key, text, coach_name)
       values ($1, 'other|e4', 'Kita pastaba', 'Kitas treneris')`,
      [must(one).id],
    );
    await forget();
    await backfill();
    expect(await originsOf('p')).toMatchObject([
      { forked_from_repertoire_id: null, forked_from_coach_name: null },
    ]);
  });

  it('gives no source when two repertoires match a forked assignment’s timestamp, only the coach its notes carry', async () => {
    await assignTo('p');
    const forkId = await fork('p');
    await client.query(
      `insert into repertoires (owner_account_id, side, name, created_at, updated_at)
       values ('p', 'white', 'Londono sistema', $1, $1)`,
      [LATER],
    );
    await forget();
    await backfill();
    const origins = await originsOf('p');
    expect(origins.find((one) => one.id === forkId)).toMatchObject({
      forked_from_repertoire_id: null,
      forked_from_coach_name: 'Name c',
    });
    expect(origins.find((one) => one.id !== forkId)).toMatchObject({
      forked_from_repertoire_id: null,
      forked_from_coach_name: null,
    });
  });
});

describe('the coach progress read of a forked assignment (#328) - SECURITY', () => {
  beforeEach(async () => {
    group = await seedGroup(db, 'c', 'Šeštadienio grupė');
    await seedMember(db, 'c', group, 'p');
    succeeded(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: { kind: 'group', groupId: group },
          deadline: null,
        },
        NOW,
      ),
    );
  });

  const forkedRow = async () =>
    must(await coachPlayerProgress(db, 'c', 'p', LATER)).rows.find(
      (row) => row.repertoire.id === rep,
    );

  it('names the fork the player shares with this coach, on the player page and the group grid', async () => {
    const forkId = await fork('p');
    await share('p', forkId, 'c');
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: forkId,
    });
    const page = must(await coachGroupPage(db, 'c', group, LATER));
    expect(page.grid.rows[0]?.cells[0]?.view).toEqual({
      kind: 'forked',
      sharedForkId: forkId,
    });
  });

  it('names the newest shared fork when the player forked the assignment twice (R-128)', async () => {
    const older = await fork('p');
    await assignTo('p');
    const again = await forkAssignment(
      db,
      { playerId: 'p', repertoireId: rep },
      new Date(LATER.getTime() + 60_000),
    );
    if (!again.ok) throw new Error(again.refusal.reason);
    const newer = again.value.forkId;
    // Shared oldest first: the order of sharing never decides.
    await share('p', older, 'c');
    await share('p', newer, 'c');
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: newer,
    });
    await unshareRepertoire(db, {
      ownerId: 'p',
      repertoireId: newer,
      coachId: 'c',
    });
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: older,
    });
  });

  it('names no fork the player keeps unshared, or shares with another coach only (R-39, R-43)', async () => {
    const forkId = await fork('p');
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: null,
    });
    await share('p', forkId, 'c2');
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: null,
    });
    await share('p', forkId, 'c');
    await unshareRepertoire(db, {
      ownerId: 'p',
      repertoireId: forkId,
      coachId: 'c',
    });
    expect((await forkedRow())?.view).toEqual({
      kind: 'forked',
      sharedForkId: null,
    });
  });

  it('gives the domain the shared forks of this coach’s repertoires only', async () => {
    const forkId = await fork('p');
    expect((await coachProgressFacts(db, 'c', ['p'])).get('p')).toMatchObject({
      sharedForks: [],
    });
    await share('p', forkId, 'c');
    expect((await coachProgressFacts(db, 'c', ['p'])).get('p')).toMatchObject({
      sharedForks: [
        { repertoireId: forkId, sourceRepertoireId: rep, createdAt: LATER },
      ],
    });
  });

  it('names no fork once the coach is unlinked, nor after a new link (R-39)', async () => {
    const forkId = await fork('p');
    await share('p', forkId, 'c');
    succeeded(await unlink(db, 'c', 'p', LATER));
    const facts = must((await coachProgressFacts(db, 'c', ['p'])).get('p'));
    expect(facts).toMatchObject({ linked: false, sharedForks: [] });
    expect(progressRepertoire('c', 'p', rep, facts)).toBeUndefined();
    expect(await coachPlayerProgress(db, 'c', 'p', LATER)).toBeUndefined();
    await seedLink(db, 'c', 'p');
    expect((await coachProgressFacts(db, 'c', ['p'])).get('p')).toMatchObject({
      linked: true,
      sharedForks: [],
    });
  });

  it("reads where a shared repertoire came from only when it is this coach's", async () => {
    const forkId = await fork('p');
    const own = await seedRepertoire(db, 'p', NOW);
    const other = await seedRepertoire(db, 'c2', NOW);
    expect(
      await assign(
        db,
        {
          coachId: 'c2',
          repertoireId: other,
          target: { kind: 'player', playerId: 'p' },
          deadline: null,
        },
        NOW,
      ),
    ).toEqual(OK);
    const othersFork = await fork('p', other);
    for (const id of [forkId, own, othersFork]) await share('p', id, 'c');
    const pairs = await sharedPairs(db, 'c', ['p']);
    expect(
      pairs.toSorted((a, b) => a.repertoireId.localeCompare(b.repertoireId)),
    ).toEqual(
      [
        {
          playerId: 'p',
          repertoireId: forkId,
          sourceRepertoireId: rep,
          createdAt: LATER,
        },
        {
          playerId: 'p',
          repertoireId: own,
          sourceRepertoireId: null,
          createdAt: NOW,
        },
        {
          playerId: 'p',
          repertoireId: othersFork,
          sourceRepertoireId: null,
          createdAt: LATER,
        },
      ].toSorted((a, b) => a.repertoireId.localeCompare(b.repertoireId)),
    );
  });
});
