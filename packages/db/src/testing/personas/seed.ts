/**
 * Writes the persona definitions into a database through the app's own
 * repositories and domain decisions, never around them: invites accepted
 * to link, assign to assign, recordResults to train. Only the account row
 * itself is inserted directly, as Better Auth (in apps/web) inserts it.
 *
 * Idempotent by replacement: each run first deletes the persona accounts
 * (deleteAccount, by email, so one the test sign-in made is replaced too)
 * and with them, by cascade, everything they own, then seeds afresh. Two
 * runs leave the same rows, and a run resets whatever persona testers
 * changed. Accounts outside the personas are never deleted, but deleting a
 * persona coach runs the app's R-49 auto-fork: a non-persona local account
 * linked to that coach keeps a fork of each repertoire it had from them.
 */
import { randomUUID } from 'node:crypto';
import type { Side } from '@mychess/chess';
import {
  DEFAULT_TRAINING_SETTINGS,
  deadlineSchema,
  groupNameSchema,
  personaEmail,
  personalNoteSchema,
  profileSchema,
  repertoireNameSchema,
  type AssignmentTarget,
  type Result,
} from '@mychess/domain';
import {
  completeOnboarding,
  findAccountByEmail,
  findAccountById,
} from '../../accounts';
import { deleteAccount } from '../../account-delete';
import { assign } from '../../assignments/assign';
import { forkAssignment } from '../../assignments/fork';
import type { Db } from '../../client';
import { startCoaching } from '../../coaching';
import { createGroup } from '../../groups';
import { acceptInvite, createInvite } from '../../invites';
import { setAssignedPersonalNote, setPersonalNote } from '../../personal-notes';
import { editRepertoire } from '../../repertoires/edit';
import { createRepertoire, loadRepertoire } from '../../repertoires/repository';
import { accounts } from '../../schema';
import { shareRepertoire } from '../../shares';
import { recordResults } from '../../training/results';
import { reviewsOf } from '../../training/reviews';
import {
  PERSONA_ACCOUNTS,
  PERSONA_GROUP,
  PERSONA_LINKS,
  type PersonaAccount,
  type PersonaKey,
  type PersonaLink,
} from './accounts';
import {
  PERSONA_ASSIGNMENTS,
  PERSONA_FORKS,
  PERSONA_NOTES,
  PERSONA_SHARES,
  PERSONA_TRAINING,
  type PersonaAssignment,
  type PersonaFork,
  type PersonaNote,
  type PersonaTraining,
} from './definitions';
import {
  chapterKeys,
  importChapters,
  moveKeyAt,
  type ImportedChapters,
  type PersonaRepertoire,
} from './lines';
import { PERSONA_REPERTOIRES } from './repertoires';
import {
  planTraining,
  weekBatches,
  type PlannedDay,
  type TrainingScript,
} from './training-plan';

/** What a seed made, for the command to report. */
export interface SeedSummary {
  readonly accounts: number;
  readonly repertoires: number;
  /** Reviews due at the seed date, by persona email. */
  readonly due: Readonly<Record<string, number>>;
}

/** A seeded repertoire: its id, owner and the moves it was made from. */
interface Seeded {
  readonly id: string;
  readonly owner: PersonaKey;
  readonly side: Side;
  readonly chapters: ImportedChapters;
}

/** What the account step needs: the database, the seed date, the ids so far. */
interface AccountSeeding {
  readonly db: Db;
  readonly now: Date;
  readonly ids: Map<PersonaKey, string>;
  readonly repertoires: Map<string, Seeded>;
}

/** Everything later steps look up: account ids, the group, the repertoires. */
interface Seeding extends AccountSeeding {
  readonly groupId: string;
}

/** The value of a repository result; a refusal means the definitions are wrong. */
function expectOk<T>(
  result: Result<T, { readonly reason: string }>,
  what: string,
): T {
  if (!result.ok)
    throw new Error(`persona seed: ${what}: ${result.refusal.reason}`);
  return result.value;
}

function lookup<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`persona seed: no ${String(key)}`);
  return value;
}

const canonicalEmail = (email: string): string =>
  expectOk(personaEmail(email), email);

/** The definition of persona `key`; throws when there is none. */
function personaAccount(key: PersonaKey): PersonaAccount {
  const found = PERSONA_ACCOUNTS.find((a) => a.key === key);
  if (found === undefined) throw new Error(`persona seed: no account ${key}`);
  return found;
}

/** The definition of repertoire `handle`; throws when there is none. */
function personaRepertoire(handle: string): PersonaRepertoire {
  const found = PERSONA_REPERTOIRES.find((r) => r.handle === handle);
  if (found === undefined)
    throw new Error(`persona seed: no repertoire ${handle}`);
  return found;
}

/** Deletes the persona accounts, players before coaches (no R-49 forks). */
async function removePersonas(db: Db, now: Date): Promise<void> {
  for (const persona of [...PERSONA_ACCOUNTS].reverse()) {
    const found = await findAccountByEmail(db, canonicalEmail(persona.email));
    if (found !== undefined) await deleteAccount(db, found.id, now);
  }
}

/**
 * The account as Better Auth creates it on a test sign-in (apps/web
 * test-sign-in.ts: canonical email, verified, no name), then onboarded and
 * switched to Coach mode through the repositories.
 */
async function createAccount(
  s: AccountSeeding,
  persona: PersonaAccount,
): Promise<void> {
  const id = `persona-${persona.key}`;
  await s.db.insert(accounts).values({
    id,
    email: canonicalEmail(persona.email),
    emailVerified: true,
    displayName: '',
    createdAt: persona.since,
    updatedAt: persona.since,
  });
  const profile = profileSchema.parse(persona.profile);
  expectOk(await completeOnboarding(s.db, id, profile, persona.since), id);
  if (persona.coach) await startCoaching(s.db, id, persona.since);
  s.ids.set(persona.key, id);
}

/** The coach's group; returns its id. */
async function createPersonaGroup(s: AccountSeeding): Promise<string> {
  const { coach, name, createdAt } = PERSONA_GROUP;
  const created = await createGroup(
    s.db,
    lookup(s.ids, coach),
    groupNameSchema.parse(name),
    createdAt,
  );
  return expectOk(created, name);
}

/** The link as a player makes it: accepting the coach's invite on its day. */
async function link(s: Seeding, l: PersonaLink): Promise<void> {
  const created = await createInvite(s.db, {
    coachId: lookup(s.ids, l.coach),
    kind: l.inGroup ? 'group' : 'personal',
    groupId: l.inGroup ? s.groupId : null,
    now: l.at,
  });
  const { token } = expectOk(created, `invite for ${l.player}`);
  const playerId = lookup(s.ids, l.player);
  expectOk(await acceptInvite(s.db, token, playerId, l.at), `link ${l.player}`);
}

/** The PGN import of a repertoire's lines, as the app's import makes it. */
async function createPersonaRepertoire(
  s: Seeding,
  r: PersonaRepertoire,
): Promise<void> {
  const chapters = importChapters(r.side, r.chapters);
  const created = await createRepertoire(s.db, {
    ownerId: lookup(s.ids, r.owner),
    side: r.side,
    name: repertoireNameSchema.parse(r.name),
    graph: chapters.graph,
    now: personaAccount(r.owner).since,
  });
  const id = expectOk(created, r.name);
  s.repertoires.set(r.handle, { id, owner: r.owner, side: r.side, chapters });
}

const targetOf = (s: Seeding, to: PersonaAssignment['to']): AssignmentTarget =>
  to === 'group'
    ? { kind: 'group', groupId: s.groupId }
    : { kind: 'player', playerId: lookup(s.ids, to) };

async function assignOne(s: Seeding, a: PersonaAssignment): Promise<void> {
  const repertoire = lookup(s.repertoires, a.repertoire);
  const request = {
    coachId: lookup(s.ids, repertoire.owner),
    repertoireId: repertoire.id,
    target: targetOf(s, a.to),
    deadline: a.deadline === null ? null : deadlineSchema.parse(a.deadline),
  };
  expectOk(await assign(s.db, request, a.at), `assign ${a.repertoire}`);
}

/** The fork, then the player's own chapters imported into it. */
async function fork(s: Seeding, f: PersonaFork): Promise<void> {
  const source = lookup(s.repertoires, f.source);
  const playerId = lookup(s.ids, f.player);
  const forked = await forkAssignment(
    s.db,
    { playerId, repertoireId: source.id },
    f.at,
  );
  const { forkId } = expectOk(forked, `fork ${f.source}`);
  const [player, loaded] = [
    await findAccountById(s.db, playerId),
    await loadRepertoire(s.db, forkId, playerId),
  ];
  if (player === undefined || loaded === undefined)
    throw new Error(`persona seed: fork ${f.handle} not found`);
  const added = importChapters(source.side, f.added);
  const edited = await editRepertoire(s.db, {
    id: forkId,
    viewer: player,
    expectedVersion: loaded.repertoire.version,
    change: { kind: 'import', imported: added.imported },
    now: f.at,
  });
  expectOk(edited, `chapters of ${f.handle}`);
  const all = personaRepertoire(f.source).chapters;
  s.repertoires.set(f.handle, {
    id: forkId,
    owner: f.player,
    side: source.side,
    chapters: importChapters(source.side, [...all, ...f.added]),
  });
}

async function share(s: Seeding, handle: string, coach: PersonaKey, at: Date) {
  const repertoire = lookup(s.repertoires, handle);
  const shared = await shareRepertoire(s.db, {
    ownerId: lookup(s.ids, repertoire.owner),
    repertoireId: repertoire.id,
    coachId: lookup(s.ids, coach),
    now: at,
  });
  expectOk(shared, `share ${handle}`);
}

/** On the player's own repertoire, or on one assigned to them live. */
async function note(s: Seeding, n: PersonaNote): Promise<void> {
  const repertoire = lookup(s.repertoires, n.repertoire);
  const input = {
    playerId: lookup(s.ids, n.player),
    repertoireId: repertoire.id,
    moveKey: moveKeyAt(repertoire.chapters, n.chapter, n.move),
    text: personalNoteSchema.parse(n.text),
    now: n.at,
  };
  const written =
    repertoire.owner === n.player
      ? await setPersonalNote(s.db, input)
      : await setAssignedPersonalNote(s.db, input);
  expectOk(written, `note on ${n.move}`);
}

/** A training definition as the planner takes it: chapters made move keys. */
function scriptOf(s: Seeding, t: PersonaTraining): TrainingScript {
  const chaptersOf = (handle: string) => lookup(s.repertoires, handle).chapters;
  return {
    // One session a day at the default size: personas keep the defaults.
    reviewsPerDay: DEFAULT_TRAINING_SETTINGS.sessionSize,
    trainedDaysAgo: t.trainedDaysAgo,
    learn: t.learned.map((l) => ({
      daysAgo: l.daysAgo,
      repertoire: l.repertoire,
      keys: chapterKeys(chaptersOf(l.repertoire), l.chapter),
    })),
    lapses: new Map(
      t.lapses.map((l) => [
        moveKeyAt(chaptersOf(l.repertoire), l.chapter, l.move),
        l.count,
      ]),
    ),
  };
}

/**
 * Records one batch of planned days as the browser would send it, at the
 * time of its last answer; every result must apply, or the plan and the
 * app disagree.
 */
async function recordBatch(
  s: Seeding,
  playerId: string,
  batch: readonly PlannedDay[],
): Promise<void> {
  const results = batch.flatMap((day) =>
    day.results.map((r) => ({
      resultId: randomUUID(),
      kind: r.kind,
      moveKey: r.moveKey,
      repertoireId: lookup(s.repertoires, r.repertoire).id,
      answeredAt: day.at,
    })),
  );
  const last = batch.at(-1)?.at ?? s.now;
  const answers = await recordResults(s.db, playerId, results, last);
  const refused = answers.find((a) => a.status !== 'applied');
  if (refused !== undefined)
    throw new Error(`persona seed: training ${playerId}: ${refused.status}`);
}

async function train(s: Seeding, t: PersonaTraining): Promise<void> {
  const playerId = lookup(s.ids, t.player);
  const plan = planTraining(scriptOf(s, t), s.now);
  for (const batch of weekBatches(plan)) await recordBatch(s, playerId, batch);
}

async function dueCounts(s: Seeding): Promise<Record<string, number>> {
  const due: Record<string, number> = {};
  for (const persona of PERSONA_ACCOUNTS) {
    const reviews = await reviewsOf(s.db, lookup(s.ids, persona.key));
    due[persona.email] = [...reviews.values()].filter(
      (r) => r.review.fsrs.due.getTime() <= s.now.getTime(),
    ).length;
  }
  return due;
}

/** The pending invite to the group, open at the seed date (coach.md). */
async function pendingInvite(s: Seeding): Promise<void> {
  const created = await createInvite(s.db, {
    coachId: lookup(s.ids, PERSONA_GROUP.coach),
    kind: 'group',
    groupId: s.groupId,
    now: s.now,
  });
  expectOk(created, 'pending invite');
}

async function writeCoaching(s: Seeding): Promise<void> {
  for (const l of PERSONA_LINKS) await link(s, l);
  for (const r of PERSONA_REPERTOIRES) await createPersonaRepertoire(s, r);
  for (const a of PERSONA_ASSIGNMENTS) await assignOne(s, a);
  for (const f of PERSONA_FORKS) await fork(s, f);
  for (const sh of PERSONA_SHARES)
    await share(s, sh.repertoire, sh.coach, sh.at);
  for (const n of PERSONA_NOTES) await note(s, n);
  await pendingInvite(s);
}

/**
 * Seeds the personas as of `now` (the seed date: training history is
 * relative to it, the docs' dated events are not). Replaces any persona
 * accounts already there.
 */
export async function seedPersonas(db: Db, now: Date): Promise<SeedSummary> {
  await removePersonas(db, now);
  const base: AccountSeeding = {
    db,
    now,
    ids: new Map(),
    repertoires: new Map(),
  };
  for (const persona of PERSONA_ACCOUNTS) await createAccount(base, persona);
  const s: Seeding = { ...base, groupId: await createPersonaGroup(base) };
  await writeCoaching(s);
  for (const t of PERSONA_TRAINING) await train(s, t);
  return {
    accounts: s.ids.size,
    repertoires: s.repertoires.size,
    due: await dueCounts(s),
  };
}
