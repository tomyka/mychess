# Assignment Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the rule "an assignment reaches a player through their own row or a group they are in, and is live unless they forked it" once in SQL (`packages/db/src/assignments/reach.ts`) and once in the domain. Read it in batches, so that `changeAssignments`, `coachAssignments` and the coach-delete auto-fork stop running per-player query loops. Make settling a change a pure domain function (#289). Behaviour, rulings and lock order stay unchanged.

**Architecture:**
- **Domain** (`packages/domain/src/assignment.ts`, new `assignment-settlement.ts`):
  - the `AssignmentFacts` record (one per player and repertoire) and the rules that decide from it: `canUseAssignment`, `canFork`, `canKeepPersonalNotes`, `deadlineSources` and `assignmentStatusOf`;
  - `settleAssignmentChange` (before and after facts in, a settlement plan out).
- **Database** (`packages/db/src/assignments/reach.ts`): the reach SQL, used four ways:
  - `assignmentFacts` (batched, unlocked);
  - `holdAssignment` (one pair, locked as today);
  - the `liveRepertoire` filter;
  - `playersReached` and the stale-state condition.

  `effective.ts` and `access.ts` are deleted. `changeAssignments` reads before and after in two batches, asks the domain for the plan, and writes it in set-based statements.
- **Web:** no change. `packages/db/src/index.ts` keeps every exported name and type.

**Tech Stack:** Drizzle 0.45.3 on Postgres 18, pg 8.23.0, zod 4, vitest 4 (Testcontainers for db), fast-check.

**Spec:** `docs/superpowers/specs/2026-10-22-assignment-reach-design.md`. **Issues:** #288, folding in #289. **Rulings kept:** R-16, R-46, R-128 to R-138. **ADR:** 0005.

**Roles:** each task names its role. Tasks marked `- SECURITY` go through `security-reviewer`. No task is UX: there is no visible change. Per task, the order is:
1. the developer, test first;
2. `qa`, which checks that the existing tests still pass unchanged except those the spec lists under "Tests that change shape";
3. `architect` (`mp-code-review` on the task's diff);
4. the security reviewer where marked;
5. the lead commits.

**Rules for every task** (CLAUDE.md):
- Test first.
- No suppression comments, no `any`, no `!`.
- Complexity <= 10, CRAP <= 30.
- Refusals stay `Result` values with the same catalogue keys.
- Parse every query result with zod.
- A teammate runs only their own package's tests.
- The lead runs `node quality/gate.mjs check` once before each commit.
- Nobody runs mutation testing locally (#273).
- **Behaviour-preserving:** a test that is not listed in the spec's "Tests that change shape" must not be edited. If one fails, the code is wrong, not the test. The developer stops and reports.

**Migration:** none. No schema change.

**Commits:** the lead commits at four checkpoints:
- after A2: `refactor(domain): assignment facts and the settlement plan (#288, #289)`;
- after B2: `refactor(db): one assignment reach module; player reads and holds on it (#288)`;
- after B3: `refactor(db): changeAssignments settles a batch through the domain plan (#288, #289)`;
- after B4: `refactor(db): coach reads and coach-delete on assignment facts (#288)`.

A1 and A2 only add to the domain, and the signature changes land in B2 together with their db callers, so every checkpoint typechecks. If knip flags a new export as unused at a checkpoint, the lead holds the commit until the next checkpoint instead of suppressing.

---

## Verified library API

Checked against the installed packages while planning (2026-10-22). A worker who finds a difference stops and tells the lead.

- **drizzle-orm 0.45.3:**
  - `select(...).for(strength, config?)`, where `LockStrength` is `'update' | 'no key update' | 'share' | 'key share'` and `LockConfig` has an optional `of` (`pg-core/query-builders/select.types.d.ts:60-72`). Without `of`, the lock applies to every table in `FROM`, joins included: today's `holdReach` group statement locks both `assignments` and `group_members` that way, and B1 keeps it.
  - `inArray(column, [])` gives `sql\`false\`` (`sql/expressions/conditions.js:73-77`). The reach module still returns early on an empty batch, so it runs no statement for it.
- **pg 8.23.0:**
  - `Client.prototype.query` (`pg/lib/client.js:668`) is the one method drizzle's node-postgres session calls (`drizzle-orm/node-postgres/session.js:113,124,143`).
  - Pool clients are `Client` instances, so `vi.spyOn(pg.Client.prototype, 'query')` counts every statement, `BEGIN` and `COMMIT` included.
  - B1 step 1 proves this with a spike test before anything relies on it.
- **Postgres 18:**
  - A locking clause locks rows only of the tables in `FROM`, never those read in a `WHERE` subquery. So the link check written as `exists (...)` adds no lock. The race tests listed in the spec prove the lock set unchanged.
  - `FOR KEY SHARE` is not allowed with `UNION`, so the individual and group reach statements stay two statements.
- **The code this plan builds on:**
  - `effective.ts:58-168`;
  - `access.ts:28-92`;
  - `player-state.ts:41-93`;
  - `assign.ts:54-72` and `:167-182`;
  - `coach.ts:119-275`;
  - `coach-delete.ts:15-62`;
  - `change.ts:35-175`;
  - `snapshot.ts:37-60`;
  - `player.ts:118-131`, `:146-161`, `:257-271` and `:341`;
  - `personal-notes.ts:48`, `:55-63`, `:73-96` and `:212-221`;
  - `fork.ts:155-156`;
  - domain `assignment.ts:218-240` and `repertoire.ts:105-117`.

---

## Decisions taken while planning

None of these is a product rule.

1. **The domain types are plain data.**

```ts
/** One assignment row through which a player has a repertoire. */
export interface AssignmentReach extends AssignmentStart {
  readonly assignmentId: string;
  /** The row's own deadline, `YYYY-MM-DD`, or null. */
  readonly deadline: string | null;
  // joinedAt (AssignmentStart): null for the player's own row, the join time for a group row.
}

/** What is known of one player's assignment of one repertoire (R-16, R-46, R-128). */
export interface AssignmentFacts {
  readonly playerId: string;
  readonly repertoireId: string;
  /** The repertoire's owner; every reaching row is theirs (assignments_repertoire_fk). */
  readonly coachId: string;
  readonly reaches: readonly AssignmentReach[];
  readonly pausedAt: Date | null;
  readonly seenVersion: number | null;
  readonly forkedAt: Date | null;
}
```

2. **`canUseAssignment(facts: AssignmentFacts | undefined)`** is allowed only when `facts !== undefined && facts.reaches.length > 0 && facts.forkedAt === null`. Otherwise it refuses with `assignment.notFound`.
   - `canFork` is the same rule.
   - `canKeepPersonalNotes(player, repertoire, facts | undefined)` allows the owner, or else uses `canUseAssignment`.
   - `AssignmentHold` is removed in B2, not left beside the new type (replace, don't layer).
3. **`assignmentStatusOf(facts, { done, now })`** returns `{ deadline, overdue, paused, done, forked }`:
   - `deadline` is `effectiveDeadline(deadlineSources(facts.reaches))`;
   - the rest is `assignmentStatus({ deadline, done, paused: !isTrainingActive(facts.pausedAt), forked: facts.forkedAt !== null }, now)`.

   This matches `coach.ts:156-171` exactly. It matches `player.ts:153-160` for every record that path sees, because those records are never forked.
4. **`deadlineSources(reaches)`** is `effective.ts:107-117` moved: a reach with `joinedAt === null` is the individual source, and every other reach becomes `{ deadline, joinedDay: vilniusDay(joinedAt) }`.
5. **`settleAssignmentChange`** has this signature:

```ts
export interface PlayerRepertoire {
  readonly playerId: string;
  readonly repertoireId: string;
}

export interface SettlementFacts {
  readonly coachId: string;
  /** In the caller's order; repeats count once. */
  readonly playerIds: readonly string[];
  readonly before: readonly AssignmentFacts[];
  readonly after: readonly AssignmentFacts[];
  /** The repertoire an assign gives: forked players have it live again (R-128). */
  readonly given?: string;
}

export interface Settlement {
  /** Forked pairs of the given repertoire, cleared (R-128). */
  readonly unfork: readonly PlayerRepertoire[];
  /** Lost pairs: a 30-day fork offer each (R-44, R-45, R-130, R-131). */
  readonly offer: readonly PlayerRepertoire[];
  /** Regained pairs: the open offer closes (S5 lead decision 4). */
  readonly close: readonly PlayerRepertoire[];
}
```

   The rules:
   - A pair is live for the settlement when `facts.coachId === coachId` and `canUseAssignment(facts).ok`. Facts of the `given` repertoire are judged with `forkedAt: null`.
   - Only players in `playerIds` are settled.
   - `offer` and `close` are ordered by first appearance in `playerIds`, then by repertoire id ascending, the order `change.ts` writes today.
   - `unfork` holds the after-facts of `given` with `forkedAt !== null`.
6. **The reach statements.** A scope is one of two shapes:

```ts
export type ReachScope =
  | { readonly playerIds: readonly string[]; readonly coachId?: string; readonly repertoireId?: string }
  | { readonly coachId: string; readonly repertoireId?: string };
```

   - **The individual statement** reads from `assignments`. It takes rows where `player_id is not null`, applies the scope to `assignments.player_id`, and requires a link with `exists (select 1 from coach_links where coach_id = assignments.coach_id and player_id = assignments.player_id)`.
   - **The group statement** reads from `assignments` inner-joined to `group_members`. It applies the scope to `group_members.player_id` and has the same `exists` link check on `group_members.player_id`.
   - **The state statement** reads `assignment_players`:
     - unlocked, it reads the pairs the two statements found;
     - in `holdAssignment`, it reads the (player, repertoire) key whether or not anything reaches it, `FOR UPDATE`, as `player-state.ts:85-91` does today.
   - **Records** are sorted by player id, then repertoire id. A record's `reaches` lists the individual row first, then group rows by assignment id.
7. **`AssignmentChange` gains `given?: string`.**
   - `assign` passes `given: req.repertoireId`, and `clearForks` goes.
   - Every other caller (`coaching.ts:201`, `groups.ts:151/192/222/266`, `invites.ts:253`, `assign.ts:285/320`) is unchanged.
8. **Set-based writes** use one statement each, with the pairs written as `or(...pairs.map((p) => and(eq(col.player, p.playerId), eq(col.repertoire, p.repertoireId))))`. An empty list writes nothing.
9. **`takeSnapshots(tx, pairs)`** returns a `Map` keyed by pair:
   - it loads each distinct repertoire once with `loadRepertoireRows(tx, eq(repertoires.id, id))`;
   - it reads the personal notes of all pairs in one statement, ordered by player, repertoire and move key, then filters them per pair;
   - `takeSnapshot(tx, playerId, repertoireId)` stays for `fork.ts`, as a call to `takeSnapshots` with one pair.

   `offerForks` throws `offerFork: the repertoire is gone; unassign it first` when a lost repertoire is missing, and `offerFork: the coach is gone` when an owner's account is missing. These are the same messages as today: the test at `assignments.test.ts:305-317` matches the first.
10. **Statement counts are proved relative, not absolute.** `countStatements(run)` (test support) spies on `pg.Client.prototype.query` and returns the number of calls. Each count test runs the same operation for one player and for five, and expects equal counts. Where repertoires are lost, it compares one lost repertoire with one player against one lost repertoire with five players.

---

## File structure

**packages/domain** (backend-dev):
- `src/assignment.ts`:
  - adds `AssignmentReach`, `AssignmentFacts`, `deadlineSources` and `assignmentStatusOf` (A1);
  - changes `canUseAssignment` and `canFork` and removes `AssignmentHold` (B2).
- `src/assignment.test.ts`: new cases (A1). The `canUseAssignment`/`canFork` table is re-expressed as facts (B2).
- `src/assignment-settlement.ts`, `src/assignment-settlement.test.ts` (new, A2).
- `src/repertoire.ts`, `src/repertoire.test.ts`: `canKeepPersonalNotes` takes facts (B2).
- `src/index.ts`: exports.

**packages/db** (backend-dev):
- `src/assignments/reach.ts` (new, B1).
- `test/reach.test.ts` (new, B1). It matches the db vitest `include` (`test/**/*.test.ts`), so the gate runs it.
- `test/support/statements.ts` (new, B1): `countStatements`.
- `src/assignments/effective.ts`, `src/assignments/access.ts`: deleted (B2).
- `src/assignments/player.ts`, `player-state.ts`, `fork.ts`, `src/personal-notes.ts`: moved onto `reach.ts` (B2).
- `src/assignments/change.ts`, `assign.ts`, `snapshot.ts` (B3).
- `src/assignments/coach.ts`, `coach-delete.ts` (B4).
- `test/assignments.test.ts`: the `effectiveAssignments` block moves to `reach.test.ts` (B1, B2), and statement-count cases are added (B3, B4).
- `test/assignment-player.test.ts`: the import path of `liveRepertoire` (B2).

---

## Part A: rules (domain)

### Task A1: Assignment facts and the decisions on them (backend-dev) - SECURITY

**Files:**
- Modify: `packages/domain/src/assignment.ts`, `src/index.ts`
- Test: `packages/domain/src/assignment.test.ts`

- [ ] **Step 1: Write the tests.**
  - **`deadlineSources`:**
    - an individual reach and a group reach give `{ individual: { deadline }, groups: [{ deadline, joinedDay }] }`, with `joinedDay` as `vilniusDay(joinedAt)`;
    - a join at 2026-10-15T22:30Z gives `'2026-10-16'` (the Vilnius day boundary);
    - group reaches only give no `individual` key (`not.toHaveProperty('individual')`);
    - no reaches give `{ groups: [] }`.
  - **`assignmentStatusOf`**, a table of cases:
    - individual deadline passed and not done is `overdue`;
    - done is never overdue (R-129);
    - paused and passed is overdue and paused (R-132);
    - forked shows only `forked`, with the deadline still given;
    - a group deadline earlier than the join day is moved to the join day (R-16);
    - an individual deadline of null wins over a group deadline (R-134).
  - **Agreement:** for each case, `assignmentStatusOf(f, …)` equals `{ deadline: effectiveDeadline(deadlineSources(f.reaches)), ...assignmentStatus(...) }`, built the way `coach.ts:156-171` builds it today.

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- assignment`. It should fail because the functions are missing.

- [ ] **Step 3: Implement.** Add the types (decision 1), `deadlineSources` (decision 4) and `assignmentStatusOf` (decision 3) to `assignment.ts`, and export them from `src/index.ts`. Leave `canUseAssignment`, `canFork` and `AssignmentHold` as they are until B2.

- [ ] **Step 4:** Run the domain tests and check they pass. Report.

### Task A2: Settling a change as a pure decision (#289) (backend-dev) - SECURITY

**Files:**
- Create: `packages/domain/src/assignment-settlement.ts`, `assignment-settlement.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the tests.** Build facts with a small `facts({ player, repertoire, coach?, forkedAt?, reaches? })` helper in the test file.
  - **Examples, each mirroring a `changeAssignments` case in `packages/db/test/assignments.test.ts:210-420`:**
    - a player who loses the coach's repertoire is in `offer`;
    - a player who keeps it through an individual row is not (R-16);
    - a forked player who loses it is not (R-128);
    - a player who regains it is in `close`;
    - another coach's repertoire, lost or gained, appears in neither list;
    - a player named twice is settled once;
    - an empty `playerIds` gives three empty lists;
    - a player not in `playerIds` is ignored even if their facts are given.
  - **`given` (R-128 reassign):**
    - before forked, after forked, `given` = that repertoire: in `unfork` and in `close`, not in `offer`;
    - after forked on another repertoire: not in `unfork`.
  - **Order:** `playerIds: ['q', 'p']`, each losing `r2` and `r1`, gives `offer` as `q/r1, q/r2, p/r1, p/r2`.
  - **Properties (fast-check):** over random before and after sets of pairs, with random fork flags and coaches:
    - `offer` and `close` never share a pair;
    - every `offer` pair is the coach's and live before;
    - every `close` pair is live after;
    - every `unfork` pair is of `given`.

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- assignment-settlement`. It should fail.

- [ ] **Step 3: Implement** `settleAssignmentChange` (decision 5). Split it into small functions:
  - `liveSet(facts, coachId, given)` gives a `Map<player, Set<repertoire>>`;
  - `difference(a, b, players)` gives sorted pairs;
  - `unforked(after, players, given)`.

  It uses `canUseAssignment` (from `assignment.ts`) on a copy with `forkedAt: null` for `given`. Until B2 changes its signature, adapt with the old shape: `{ assigned: facts.reaches.length > 0, forked: facts.forkedAt !== null }`. B2 removes that adapter.

- [ ] **Step 4:** Run the domain tests and check they pass. Report. The lead commits A1 and A2.

---

## Part B: database

### Task B1: The reach module (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/reach.ts`, `packages/db/test/reach.test.ts`, `packages/db/test/support/statements.ts`

- [ ] **Step 1: Spike the counter.** Write `test/support/statements.ts`:

```ts
import pg from 'pg';
import { vi } from 'vitest';

/** How many statements `run` sends, BEGIN and COMMIT included. */
export async function countStatements(
  run: () => Promise<unknown>,
): Promise<number> {
  const spy = vi.spyOn(pg.Client.prototype, 'query');
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}
```

   Add a first test in `reach.test.ts`:
   - `countStatements(() => db.select().from(accounts))` is 1;
   - the same select inside `db.transaction` is 3.

   If either number differs, stop and tell the lead (decision 10 needs it).

- [ ] **Step 2: Write the tests.** Use the seed of `assignments.test.ts:174-189`: coach `c`, players `p`, `q` and `n` linked, group `g` with `p` and `q`, and `c`'s repertoire `rep`. Insert assignments directly.
  - **The six `effectiveAssignments` cases (`assignments.test.ts:142-207`), each re-expressed on `assignmentFacts(db, { playerIds: [...] })`:**
    - one record for an individual row plus a group row, with `reaches` `[{ assignmentId, deadline: '2026-11-01', assignedVersion: 3, joinedAt: null }, { …, deadline: '2026-10-30', assignedVersion: 1, joinedAt: T0 }]`, and `deadlineSources(reaches)` equal to the old `sources`;
    - group-only;
    - individual without a deadline;
    - empty for `n` outside the group;
    - the player's state carried;
    - a forked record is present with `forkedAt`, where `canUseAssignment` refuses it.
  - **Batch:**
    - `{ playerIds: ['p', 'q', 'n'] }` returns `p` and `q`, sorted by player;
    - `{ coachId: 'c' }` returns the same;
    - `{ coachId: 'd' }` returns nothing;
    - `{ coachId: 'c', repertoireId: other }` returns only `other`'s records;
    - `{ playerIds: [] }` returns `[]` and sends no statement (`countStatements` is 0).
  - **Count:** `assignmentFacts` for 1 player and for 5 players (add `r`, `s` and `t` to `g`) send the same number of statements.
  - **`holdAssignment(tx, { playerId: 'p', repertoireId: rep })`:**
    - returns the record;
    - returns `undefined` for `n`, and for a malformed id it sends no statement.
  - **The lock set** (the S5 pattern with `openTransaction` and `someoneWaitsForALock`):
    - a `holdAssignment` in an open transaction makes `delete from group_members where player_id = 'p'` wait;
    - while it is held, `select 1 from coach_links where coach_id = 'c' and player_id = 'p' for update nowait` succeeds. FOR UPDATE conflicts with KEY SHARE, so this proves the `exists` link check locks nothing.
  - **`liveRepertoire`:** the case at `assignment-player.test.ts:869-881`, re-run here against `reach.ts`.
  - **`playersReached(tx, [{ playerId: 'n', groupId: null }, { playerId: null, groupId: g }])`** is `['n', 'p', 'q']`, as a set.

- [ ] **Step 3:** Run `pnpm --filter @mychess/db test -- reach`. It should fail.

- [ ] **Step 4: Implement `reach.ts`:**
  - module comment: the code words *reach* and *live*, and where the domain decides;
  - the statement builders (decision 6) with an internal `lock?: 'key share'` for the reach statements and `'update'` for the state statement;
  - zod row schemas: the `rowSchema` and `stateSchema` of `effective.ts:30-44`, plus `assignmentId` and `playerId`;
  - `factsOf(rows, states)`, the fold (one record per pair);
  - `assignmentFacts`;
  - `holdAssignment`, which returns `undefined` for a non-uuid repertoire id without a statement (`isUuid`);
  - `liveRepertoire`, built from the same builders as subqueries, with `notInArray` of the forked state;
  - `playersReached`, moved from `assign.ts:54-72`;
  - `unreachedState(playerIds)`: the SQL condition that holds for an `assignment_players` row of those players that no row reaches (`not exists` over both reach statements, correlated on `assignment_players.player_id` and `.repertoire_id`).

  Keep every function at complexity 10 or below. In this task, nothing outside the tests imports `reach.ts`.

- [ ] **Step 5:** Run `pnpm --filter @mychess/db test -- reach` and check it passes. Report.

### Task B2: Player reads and holds on the reach module (backend-dev) - SECURITY

**Files:**
- Modify:
  - `packages/domain/src/assignment.ts`, `repertoire.ts`, `index.ts`, `assignment-settlement.ts` (drop the A2 adapter);
  - `packages/db/src/assignments/player.ts`, `player-state.ts`, `fork.ts`, `packages/db/src/personal-notes.ts`.
- Delete: `packages/db/src/assignments/effective.ts`, `access.ts`.
- Test (shape only, as the spec lists):
  - `packages/domain/src/assignment.test.ts:320-330`;
  - `repertoire.test.ts:225-240`;
  - `packages/db/test/assignments.test.ts:21-25,142-207` (the block is removed; B1 holds its cases);
  - `assignment-player.test.ts:35` (import path).

- [ ] **Step 1: Re-express the domain tables.**
  - `canUseAssignment`/`canFork`:
    - `[facts(), ok]`;
    - `[undefined, notFound]`;
    - `[facts({ forkedAt: NOW }), notFound]`;
    - `[facts({ reaches: [] }), notFound]`;
    - `[facts({ reaches: [], forkedAt: NOW }), notFound]`.

    These are the four old cases plus "undefined".
  - `canKeepPersonalNotes`: the same three cases, with `none` written as `undefined`.

  Run them. They should fail to compile until step 2.

- [ ] **Step 2: Change the domain** (decision 2):
  - `canUseAssignment(facts: AssignmentFacts | undefined)`;
  - `canFork` the same;
  - `canKeepPersonalNotes(player, repertoire, facts: AssignmentFacts | undefined)`;
  - remove `AssignmentHold` from `assignment.ts` and `index.ts`;
  - drop the A2 adapter.

  Run `pnpm --filter @mychess/domain test` and check it passes.

- [ ] **Step 3: Move the db callers.**
  - `player-state.ts`: delete `holdReach` and `holdAssignment` (:37-93). `onOwnAssignment` calls `canUseAssignment(await holdAssignment(tx, key))` from `reach.ts`. The doc comment keeps the lock paragraph (:1-10) and points at `reach.ts`.
  - `fork.ts:156`: `canFork(await holdAssignment(tx, req))` from `reach.ts`. The order stays: `lockCoach` first.
  - `personal-notes.ts`:
    - `NO_ASSIGNMENT` becomes `undefined`;
    - the type becomes `AssignmentFacts | undefined`;
    - the imports come from `./assignments/reach`;
    - `notesAllowedFor` keeps `or(ownedBy, liveRepertoire)`.
  - `player.ts`:
    - `usableAssignments` and `usableAssignment` become `assignmentFacts(tx, { playerIds: [playerId] })` and `assignmentFacts(tx, { playerIds: [playerId], repertoireId })`, each filtered by `canUseAssignment(f).ok`;
    - `statusOf` (:146-161) uses `assignmentStatusOf(assignment, { done, now })` and keeps returning `{ deadline, paused, done, overdue }`;
    - `isUpdated(assignment, …)` (:171) and `newsOf(assignment, rows)` (:363) receive `{ seenVersion: a.seenVersion, starts: a.reaches }`;
    - every `EffectiveAssignment` becomes `AssignmentFacts`;
    - the module comment says "canUseAssignment on assignmentFacts".
  - Delete `effective.ts` and `access.ts`.
  - Change the import in `assignment-player.test.ts:35` to `../src/assignments/reach`.
  - Remove the `effectiveAssignments` block and its imports from `assignments.test.ts` (its cases now live in `reach.test.ts`).

- [ ] **Step 4:** Run `pnpm --filter @mychess/db test`. Everything passes, including these race tests, unchanged:
  - `assignment-player.test.ts:555`, `:571` and `:966`;
  - `forks.test.ts:233`, `:251`, `:270` and `:508`.

  Report. The lead commits B1 and B2.

### Task B3: `changeAssignments` settles a batch through the domain plan (#289) (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/assignments/change.ts`, `assign.ts`, `snapshot.ts`
- Test: `packages/db/test/assignments.test.ts` (new cases only)

- [ ] **Step 1: Write the new tests.** Every existing `changeAssignments`, `assign` and `unassign` test stays as it is.
  - **No loss, count:** `addMember` of 1 player and of 5 players to a group that has `rep` assigned send the same number of statements. Each player's open offer closes, as checked in `assignments.test.ts:378-384`.
  - **Losses, count:** `unassign` of a group assignment reaching 1 member and reaching 5 members send the same number of statements. Each member gets one offer, with the snapshot of `assignments.test.ts:233-249`, and each offer's `personalNotes` holds only that member's notes.
  - **Assign, count:** `assign` to a group of 1 and of 5, where every member forked `rep` before, send the same number of statements. All of them are live again (`forked_at` null), and their open offers are closed (R-128, S5 plan decision 8).
  - **Order:** `unassignAll` of two repertoires each reaching `p` and `q` inserts the offers in the order `p/r-low, p/r-high, q/r-low, q/r-high`. Check it with `select player_id, repertoire_id from fork_offers` and no `ORDER BY`, the heap order the existing tests read.

- [ ] **Step 2:** Run `pnpm --filter @mychess/db test -- assignments`. The count tests fail.

- [ ] **Step 3: Implement.**
  - **`snapshot.ts`:** `takeSnapshots` (decision 9). `takeSnapshot` builds on it.
  - **`change.ts`:**
    - `AssignmentChange` gains `given?: string`;
    - `changeAssignments` becomes:

```ts
export async function changeAssignments<T>(
  tx: Tx,
  change: AssignmentChange,
  apply: () => Promise<T>,
): Promise<T> {
  const scope = { playerIds: change.playerIds, coachId: change.coachId };
  const before = await assignmentFacts(tx, scope);
  const result = await apply();
  const after = await assignmentFacts(tx, scope);
  const plan = settleAssignmentChange({
    coachId: change.coachId,
    playerIds: change.playerIds,
    before,
    after,
    given: change.given,
  });
  await unfork(tx, plan.unfork);
  await offerForks(tx, plan.offer, change);
  await closeOffers(tx, plan.close, change.now);
  await dropStaleState(tx, change.playerIds);
  return result;
}
```

    The helpers:
    - `unfork` is one `update assignment_players set forked_at = null` over the pairs.
    - `offerForks`:
      - calls `takeSnapshots`;
      - reads the owners' display names in one statement;
      - throws the two messages of decision 9;
      - makes one multi-row `insert` into `fork_offers` in plan order, with `reason`, `createdAt: now` and `expiresAt: forkOfferExpiry(now)`.
    - `closeOffers` is one `update fork_offers set closed_at = now` over the pairs and `openAt(now)`.
    - `dropStaleState` is one `delete from assignment_players where unreachedState(playerIds)`, and nothing for an empty batch.
    - `liveIdsOf`, `settlePlayer`, `offerFork` and the per-player `closeOffers` go.
  - **`assign.ts`:**
    - `assign` passes `given: req.repertoireId` and no longer calls `clearForks` inside `apply`;
    - delete `clearForks`;
    - delete `playersReached` and import it from `reach.ts`;
    - update the module comment: lock order unchanged.

- [ ] **Step 4:** Run `pnpm --filter @mychess/db test`. Everything passes, including these tests, unchanged:
  - `assignments.test.ts:252` (another coach meanwhile);
  - `coaching.test.ts:145` and `:404`;
  - `groups.test.ts:230`, `:333` and `:549`;
  - `invites.test.ts:424`;
  - `forks.test.ts:251` (an unassign waits for a fork, then offers nothing).

  Report. The lead commits B3.

### Task B4: Coach reads and coach-delete on assignment facts (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/assignments/coach.ts`, `coach-delete.ts`
- Test: `packages/db/test/assignments.test.ts`, `forks.test.ts` (new cases only)

- [ ] **Step 1: Write the new tests.**
  - **`coachAssignments` count:** with `rep` assigned to `g`, 1 member and 5 members send the same number of statements, and the result is unchanged in shape: the players are listed per row by name, with their badges.
  - **`assignedPlayerCount` count:** the same comparison, with the count right (5 minus the forked ones).
  - **`deleteAccount(db, 'c')` count:** compare 1 and 5 assigned players, minus the fork writes. Wrap only `forkForDeletingCoach`'s read: call `assignmentFacts(tx, { coachId: 'c' })` on 1 and 5 players and compare. R-137 is proved by the existing tests in `forks.test.ts`, which stay as they are.

- [ ] **Step 2:** Run them. The `coachAssignments` count test fails.

- [ ] **Step 3: Implement.**
  - **`coach.ts`:**
    - `coachAssignments`, inside its `SNAPSHOT` transaction and after the `canViewRepertoire` check:
      - reads `rowsOf` (unchanged, :82-104);
      - reads `assignmentFacts(tx, { coachId, repertoireId })` once;
      - reads the display names of those players in one statement (move `namesOf` from `player.ts:67-79` into `reach.ts` or a small shared helper, and import it in both);
      - lists each row's players as the records whose `reaches` include `row.id`, each mapped with `assignmentStatusOf(f, { done, now })` and sorted by name (`lt`), as today.
    - `assignedPlayerCount` counts the records with `canUseAssignment(f).ok`.
    - Delete `reachOf`, `reachedPlayer`, `playerState`, `statesOf`, `StateFacts` and `forkedPlayers`. The module comment keeps the access paragraph: the domain decides, and the query filters on `assignments.coach_id`, the repertoire's owner and the link (now the `exists` in `reach.ts`).
  - **`coach-delete.ts`:** `forkForDeletingCoach` reads `assignmentFacts(tx, { coachId })` and calls `forkAssignment(tx, { playerId, repertoireId }, now)` for each record with `canUseAssignment(f).ok`, in record order. Delete `playersOfCoach` and `liveAssigneesOfCoach`. The lock order is unchanged (`account-delete.ts:61-63`).

- [ ] **Step 4:** Run `pnpm --filter @mychess/db test`. Everything passes, including these tests, unchanged:
  - `forks.test.ts:508` (#286);
  - `shares.test.ts:304`, `:317`, `:397`, `:488` and `:684`.

  Check the spec's grep: `innerJoin(groupMembers` under `packages/db/src/assignments` is only in `reach.ts`. Report. The lead commits B4.

---

## Part C: close

### Task C1: Security review (security-reviewer) - SECURITY

- [ ] Review the B1 to B4 diff. Check:
  - every player read still goes through `canUseAssignment` on facts and the `liveRepertoire` filter;
  - the coach reads still filter on the coach, the owner and the link;
  - `holdAssignment` locks the same rows as `holdReach` did (`FOR KEY SHARE` on assignments and memberships, `FOR UPDATE` on the state);
  - no path that removes access skips `changeAssignments`;
  - the batched `update` and `delete` statements are scoped to the batch's players and pairs.

  Report findings to the lead.

### Task C2: Close (lead, architect)

- [ ] The lead runs `node quality/gate.mjs check` on the final tree, and CI's mutation run on the changed domain files must be green.
- [ ] Run `mp-code-review` on the diff since the commit before A1. The architect checks the spec's "Done means".
- [ ] Close #288 and #289 with the commit range and the CI result. Note on #278 that `reach.ts` is the player-side predicate it can compose with `ownedBy` and `sharedTo`.
- [ ] S6's plan builds `trainingRepertoires` on `assignmentFacts` and `assignmentStatusOf`, with `done` from learned moves.

---

## Self-review against the spec

| Spec item | Task |
| --- | --- |
| Decision 1: one reach module, the link check as `exists` | B1 |
| Decision 2: one fact record per pair, three statements per batch | B1 (count test) |
| Decision 3: the domain decides from facts; `AssignmentHold` gone | A1, B2 |
| Decision 4: only `holdAssignment` locks, with the same lock set | B1 (lock tests), B2 (race tests) |
| Decision 5: `liveRepertoire` from the same module | B1, B2 |
| Decision 6: #289 folded in, `settleAssignmentChange` | A2, B3 |
| Decision 7: `changeAssignments` batched, `takeSnapshots` | B3 |
| Decision 8: R-128 in the plan (`given`) | A2, B3 |
| Decision 9: what stays outside | B3 (`playersReached` moved), B4 |
| Statement counts | B1, B3, B4 |
| Lock order and the race tests | B2, B3, B4 step 4; C1 |
| Tests that change shape | B1, B2 |
| Done means | C2 |

## Spec gaps for the owner

None. Nothing here changes behaviour, a ruling or an ADR. If a task finds that the existing behaviour cannot be kept exactly, for example an offer order or a lock that has to change, the developer stops and the lead decides with the owner.
