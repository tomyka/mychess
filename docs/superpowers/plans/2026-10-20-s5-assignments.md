# S5 Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach assigns their own repertoire to linked players or to their groups, with an optional deadline. Players get it live: coach edits reach them and show "Updated" with a summary. A player can pause an assignment or fork it into their own copy. When an assignment ends for a player (unassign, unlink, leaving a group, repertoire delete), the player gets a 30-day fork offer. When a coach deletes their account, every player gets an automatic fork.

**Architecture:**
- **Domain** (`packages/domain/src/assignment.ts`, `fork-offer.ts`, `calendar.ts`): pure rules for assigning, the effective deadline, status badges and fork offers.
- **Chess** (`packages/chess`): owns the graph diff (`graphChanges`, #277), the per-edit player-move changes and their net over several edits, and `allLearned`. Reconciliation itself already exists (`reconcile`, `heldKeys` in `training/`). Reviews are keyed by player and move key (R-53), so nothing is copied or rewritten per player.
- **Database** (`packages/db`): stores assignments per target (a player or a group) and derives each player's effective assignments by query. Every change that can take an assignment away from a player runs through one helper, `changeAssignments`, which compares before and after inside the transaction. It writes fork offers for what was lost and closes offers for what came back.
- **Web** (`apps/web`) gets four things:
  - an "Assign" panel on the coach's repertoire page;
  - "From my coach" and fork offers on home;
  - an assigned-repertoire page;
  - one repertoire-view module (#283) that all three views use.

**Tech Stack:** Drizzle 0.45.3 on Postgres 18 (composite foreign keys, partial unique indexes, `date` columns), Next.js 16.3 App Router with server actions, next-intl 4, zod 4, vitest 4 (with Testcontainers for db and the feature suite), fast-check, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-20-s5-assignments-design.md`. **Issue:** #255 (epic #250). **Rulings:** R-15, R-16, R-20, R-21, R-23, R-43 to R-47, R-49, R-51, R-52, R-53, R-121, R-128 to R-134. **Folds in:** #277 (graph diff into chess) and #283 (one repertoire-view module), and both close with this slice.

**Roles:** each task names its role. Tasks marked `- SECURITY` go through `security-reviewer`, and tasks marked `- UX` go through `ux-designer` and `i18n-content`. Per task the order is: developer (test first) -> `qa` -> `architect` (`mp-code-review` on the task's diff) -> security and UX reviewers where marked -> the lead commits.

**Rules for every task** (CLAUDE.md):
- Test first.
- No suppression comments, no `any`, no `!`.
- Keep functions small: complexity <= 10, CRAP <= 30.
- Every user-visible string goes through `apps/web/src/i18n/messages/{lt,en}.json`, Lithuanian first.
- Refusals are `Result` values with catalogue keys.
- Parse every request body, form, URL param, query result and stored JSON with zod.
- A `playerId`, `coachId`, `groupId` or `repertoireId` sent by a client never decides who acts. The actor is always the session account, and the domain decides whether the target is theirs.
- A teammate runs only their own package's tests. The lead runs `node quality/gate.mjs check` once before each commit. Nobody runs mutation testing locally (#273).

**Migration:** one migration for Part B, generated with `pnpm --filter @mychess/db db:generate` after Task B1. Never hand-edit it. S4's retro lesson: a composite foreign key needs its target's unique key in an earlier migration. Every target used here already exists:
- `repertoires_id_owner_unique`;
- `groups_id_coach_unique`;
- the `coach_links` primary key.

---

## Verified library API

Checked against the installed packages while planning (2026-10-20). A worker who finds a difference stops and tells the lead.

- **drizzle-orm 0.45.3:**
  - `date(name, { mode: 'string' })` from `drizzle-orm/pg-core` maps a Postgres `date` to a `YYYY-MM-DD` string.
  - `uniqueIndex(name).on(...).where(sql)` makes a partial unique index.
  - `foreignKey({...}).onDelete('cascade' | 'set null')` with `MATCH SIMPLE` semantics: a row with any null column in the key is not checked. So `assignments (coach_id, player_id)` onto `coach_links` applies only to player targets, and `(group_id, coach_id)` onto `groups` only to group targets.
  - `.for('key share')` and transactions are as in the S4 plan.
- **zod 4:** `z.iso.date()` accepts `YYYY-MM-DD`. Give it a custom message: `z.iso.date({ error: 'assignment.deadlineInvalid' })`.
- **Intl:** `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)` gives `YYYY-MM-DD` on Node 24's full ICU.
- **Existing code this plan builds on:**
  - `reconcile(repertoires, reviews)` and `heldKeys` in `packages/chess/src/training/{progress,scope}.ts`. `TrainingRepertoire` already has `active` for R-46.
  - `diffRepertoire` in `packages/db/src/repertoires/diff.ts` moves to chess in A1.
  - `createRepertoire`, `loadRepertoireRows`, `deleteRepertoire` and `saveRepertoireEdit` in `packages/db/src/repertoires/repository.ts`.
  - In `coaching.ts`: `unlink`, `coachAccessFacts` and `coachPlayer`.
  - In `groups.ts`: `addMember`, `removeMember`, `leaveGroup` and `deleteGroup`.
  - `acceptInvite` in `invites.ts`, which adds a group membership.
  - `deleteAccount` in `accounts.ts`.
  - On the web side: `requireCoach` and `assertCoachMaySee` in `apps/web/src/server/coaching.ts`, and the page loaders in `apps/web/src/server/coach-pages.ts`.

---

## Decisions taken while planning

None of these is a product rule. The possible product rules are listed under "Spec gaps for the owner" at the end, and are not implemented.

1. **`assignments` has one row per (repertoire, target).** A CHECK makes sure exactly one of `player_id` and `group_id` is set. Two partial unique indexes give "at most once per target" (lead decision 5). The foreign keys onto `repertoires (id, owner_account_id)`, `coach_links (coach_id, player_id)` and `groups (id, coach_id)` all cascade, so the database guarantees four things:
   - an assignment is always of the coach's own repertoire;
   - an assignment always reaches a linked player or the coach's own group;
   - an unlink, a group delete or a repertoire delete removes it in the same statement;
   - a group member is always linked (S4 decision 2), so a group assignment never reaches an unlinked player.
2. **`assigned_version`** is the repertoire's version when the row was made. A player's "Updated" flag (R-133) is on when a `repertoire_changes` row exists with a version greater than `coalesce(seen_version, assigned_version)`.
3. **`repertoire_changes` is written only when an edit changes a player move or an annotation.** Its JSON is chess's `MoveChanges`. A chapter rename alone writes nothing, because players see chapter names directly.
4. **`assignment_players`** holds a player's own state on a repertoire they have through an assignment: `paused_at`, `seen_version` and `forked_at`. It is created when first needed (pause, open, fork) and deleted when the player no longer has the repertoire through any assignment row.
5. **The one assignment-change helper.** `changeAssignments(tx, { playerIds, reason, now }, change)` works in three steps:
   - it reads the affected players' non-forked effective repertoire ids;
   - it runs `change` (the delete or insert);
   - it reads them again.

   Each lost pair gets a fork offer with a snapshot. Each regained pair closes the player's open offer for that repertoire (lead decision 4). Every path that adds or removes access goes through it:
   - `assign` and `unassign`;
   - `unlink`;
   - `addMember`, `removeMember` and `leaveGroup`;
   - `deleteGroup`;
   - `acceptInvite` when the invite names a group;
   - `deleteRepertoire`.

   A repertoire delete calls `unassignAll` first, so its snapshots are read while the repertoire still exists (R-131).
6. **A fork offer's snapshot** is `{ graph, personalNotes }`. The graph is the repertoire as the player last had it, with the coach's comments. The personal notes are the player's notes on it, which would otherwise be lost if the coach later deletes the repertoire. It is parsed with `repertoireGraphSchema` (new in A1) whenever it is read.
7. **Forking** creates a new repertoire owned by the player with the same chapters and moves, and these four extra things:
   - every move comment moves into `fork_coach_notes`, read-only with the coach's display name (R-47);
   - the fork's own comments start empty;
   - the player's personal notes are copied to the fork;
   - the name is the source name, unchanged.

   Reviews are untouched (R-43, R-53). A live fork sets `assignment_players.forked_at`. An accepted offer sets `fork_offers.accepted_at` and `fork_id`.
8. **Assigning again after a fork** (R-128): creating an assignment row clears `forked_at` for every player that row reaches. A forked player keeps "forked" only while some assignment row still reaches them. Once none does (they left the group, or were unassigned), `dropStaleState` deletes their state, and anything that reaches them later (a re-add to the group, a new assignment) reaches them live, next to their fork. R-128 allows this: the coach gives it again.
9. **A coach's account delete (R-49)** forks for every player with a live, non-forked assignment from that coach, in the same transaction and before the account row is deleted. Its fork notes carry the coach's display name, so they survive the cascade. The coach's open offers to others stay: they hold snapshots, and `repertoire_id` is set to null.
10. **Deadlines are `YYYY-MM-DD` strings** compared as strings. "Today" is `vilniusDay(now)`. A join date is the Vilnius day of `group_members.joined_at`.
11. **Routes:**
    - the assigned repertoire page is `/repertuarai/priskirti/[id]` (`assignedRepertoirePath(id)`);
    - the coach's assign panel lives on the existing `/repertuarai/[id]`, which only the owner can open;
    - fork offers are listed on home (`/`), and each one is answered by a server action.
12. **Refusals answer 404** on pages, as in S4 decision 4. Actions return refusal values.

---

## File structure

**packages/chess** (chess-dev):
- `src/repertoire/changes.ts` (new):
  - `graphChanges` (moved from db `diff.ts`, `changedMoves` renamed `annotatedMoves`);
  - `MoveLink`;
  - `playerMoveChanges`;
  - `netMoveChanges`;
  - `MoveChanges`.
- `src/repertoire/changes.test.ts` (new): takes over the cases of `packages/db/test/repertoire-diff.test.ts`, plus new cases.
- `src/repertoire/schema.ts`: adds `repertoireGraphSchema`.
- `src/training/progress.ts`: adds `allLearned`.
- `src/index.ts`: exports.

**packages/domain** (backend-dev):
- `src/calendar.ts` (new): `vilniusDay`.
- `src/assignment.ts` (new): `ASSIGNMENT_REFUSALS`, `deadlineSchema`, `canAssign`, `effectiveDeadline`, `assignmentStatus`, `canUseAssignment`, `canFork`.
- `src/fork-offer.ts` (new): `FORK_OFFER_DAYS`, `FORK_OFFER_REASONS`, `forkOfferExpiry`, `forkOfferState`, `canAnswerForkOffer`.
- `src/index.ts`: exports.

**packages/db** (backend-dev):
- `src/schema.ts`: `assignments`, `assignmentPlayers`, `repertoireChanges`, `forkOffers`, `forkCoachNotes`.
- `src/repertoires/diff.ts`: deleted. `write.ts` and `repository.ts` import `graphChanges` from chess.
- `src/repertoires/repository.ts`: `saveRepertoireEdit` writes `repertoire_changes`, and `deleteRepertoire` unassigns first.
- `src/assignments/effective.ts` (new): `effectiveAssignments` and `effectiveIds`.
- `src/assignments/change.ts` (new): `changeAssignments`.
- `src/assignments/snapshot.ts` (new): `takeSnapshot` and `snapshotSchema`.
- `src/assignments/fork.ts` (new): `writeFork`, `forkAssignment`, `acceptForkOffer`, `declineForkOffer` and `forkCoachNotesOn`.
- `src/assignments/assign.ts` (new): `assign`, `unassign`, `unassignAll` and `setDeadline`.
- `src/assignments/player.ts` (new): `playerAssignments`, `assignedRepertoireForPlayer`, `pauseAssignment`, `markSeen`, `changesSince`, `openForkOffers` and `trainingRepertoires`.
- `src/assignments/coach.ts` (new): `coachAssignments` and `assignedPlayerCount`.
- `src/coaching.ts`, `src/groups.ts`, `src/invites.ts`, `src/accounts.ts`: these route through `changeAssignments`, or auto-fork (R-49).
- `src/index.ts`: exports.
- `test/assignments.test.ts`, `test/fork-offers.test.ts`, `test/forks.test.ts` (new).

**apps/web** (web-dev):
- `src/app/repertoire-view/` (new, #283): `repertoire-shell.tsx`, `position-body.tsx` and `index.ts`. The owner screen and the coach's shared view move onto it.
- `src/app/repertuarai/[id]/assign-panel.tsx` and `assign-actions.ts` (new).
- `src/app/repertuarai/priskirti/[id]/page.tsx`, `assigned-view.tsx`, `changes-summary.tsx` and `actions.ts` (new).
- `src/app/from-my-coach.tsx` and `fork-offers.tsx` (new). `home-view.tsx` and `page.tsx` show them.
- `src/server/assignment-pages.ts` (new): the page loaders. `src/server/assignment-input.ts` (new): the zod input schemas.
- `src/lib/routes.ts`: `assignedRepertoirePath`.
- `test/feature/assignments.test.ts` (new).
- `e2e/assignments.spec.ts` (qa, new).

---

## Part A: rules (chess and domain)

### Task A1: `graphChanges` and the graph schema in chess (#277) (chess-dev)

**Files:**
- Create: `packages/chess/src/repertoire/changes.ts`, `packages/chess/src/repertoire/changes.test.ts`
- Modify: `packages/chess/src/repertoire/schema.ts`, `packages/chess/src/index.ts`
- Delete (lead, after chess-dev reports): `packages/db/src/repertoires/diff.ts`, `packages/db/test/repertoire-diff.test.ts`
- Modify (backend-dev, same task): `packages/db/src/repertoires/write.ts` and `repository.ts` import from `@mychess/chess`

- [ ] **Step 1: Move the tests.** Copy `packages/db/test/repertoire-diff.test.ts` to `packages/chess/src/repertoire/changes.test.ts`. Import from the local modules instead of `@mychess/chess`, call `graphChanges` instead of `diffRepertoire`, and rename `changedMoves` to `annotatedMoves` in the expectations (R-121: a comment or mark edit is an annotation, never a change). Then add:

```ts
describe('playerMoveChanges', () => {
  it('lists added and removed player moves with their chapters, and counts annotations', () => {
    const nf3 = base.moves.find((m) => m.san === 'Nf3');
    let after = ok(addMove(base, 'c1', nf3?.to ?? '', 'Nc6'));
    after = ok(addMove(after, 'c1', after.moves.find((m) => m.san === 'Nc6')?.to ?? '', 'Bb5'));
    after = ok(removeMove(after, 'c2', START, 'e4'));
    after = ok(editComment(after, keyOf('e5'), 'Main'));
    const c = playerMoveChanges(base, after);
    // White's repertoire: Bb5 is a player move, Nc6 is not.
    expect(c.added.map((l) => [splitMoveKey(l.moveKey).san, l.chapterId])).toEqual([['Bb5', 'c1']]);
    expect(c.removed).toEqual([]); // e4 stays: chapter c1 still holds it
    expect(c.annotated).toBe(1);
  });

  it('lists a removed player move once per chapter it was in', () => {
    const after = ok(removeMove(base, 'c1', base.moves.find((m) => m.san === 'e5')?.to ?? '', 'Nf3'));
    expect(playerMoveChanges(base, after).removed).toEqual([{ moveKey: keyOf('Nf3'), chapterId: 'c1' }]);
  });

  it('is empty between a graph and itself', () => {
    expect(playerMoveChanges(base, base)).toEqual({ added: [], removed: [], annotated: 0 });
  });
});

describe('netMoveChanges', () => {
  const link = (moveKey: string, chapterId = 'c1') => ({ moveKey, chapterId });
  it('drops a move added and then removed, and a move removed and then added back', () => {
    expect(
      netMoveChanges([
        { added: [link('a')], removed: [link('b')], annotated: 1 },
        { added: [link('b'), link('c')], removed: [link('a')], annotated: 2 },
      ]),
    ).toEqual({ added: [link('c')], removed: [], annotated: 3 });
  });
  it('keeps every chapter link of a move, from its last step', () => {
    expect(
      netMoveChanges([{ added: [link('a', 'c1'), link('a', 'c2')], removed: [], annotated: 0 }]),
    ).toEqual({ added: [link('a', 'c1'), link('a', 'c2')], removed: [], annotated: 0 });
  });
  it('is empty for no steps', () => {
    expect(netMoveChanges([])).toEqual({ added: [], removed: [], annotated: 0 });
  });
});
```

Add a schema test in `schema.test.ts`:

```ts
it('repertoireGraphSchema parses a graph importPgn made, and refuses a bad side', () => {
  const g = graphOf('1. e4 e5 *');
  expect(repertoireGraphSchema.parse(JSON.parse(JSON.stringify(g)))).toEqual(g);
  expect(repertoireGraphSchema.safeParse({ ...g, side: 'red' }).success).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail.** Run `pnpm --filter @mychess/chess test -- changes schema`. It is expected to fail because `./changes` does not exist yet.

- [ ] **Step 3: Implement.** Create `changes.ts` from `packages/db/src/repertoires/diff.ts`, moved verbatim with two changes: the type `RepertoireDiff` becomes `GraphChanges`, and `changedMoves` becomes `annotatedMoves`. Then append:

```ts
/** Player moves an edit added or removed, by chapter, and how many moves' annotations changed (R-121, R-133). */
export interface MoveChanges {
  readonly added: readonly MoveLink[];
  readonly removed: readonly MoveLink[];
  readonly annotated: number;
}

const playerLinks = (graph: RepertoireGraph, moves: readonly RepertoireMove[]): MoveLink[] =>
  moves
    .filter((m) => isPlayerMove(graph, m))
    .flatMap((m) => m.chapters.map((chapterId) => ({ moveKey: keyOf(m), chapterId })));

/** What an edit from `before` to `after` changes for a player who trains it. */
export function playerMoveChanges(before: RepertoireGraph, after: RepertoireGraph): MoveChanges {
  const c = graphChanges(before, after);
  const removed = new Set(c.removedMoveKeys);
  return {
    added: playerLinks(after, c.addedMoves),
    removed: playerLinks(before, before.moves.filter((m) => removed.has(keyOf(m)))),
    annotated: c.annotatedMoves.length,
  };
}

const byKey = (links: readonly MoveLink[]): Map<string, MoveLink[]> => {
  const map = new Map<string, MoveLink[]>();
  for (const l of links) map.set(l.moveKey, [...(map.get(l.moveKey) ?? []), l]);
  return map;
};

/** Moves `from` gained; a key `against` holds cancels instead. */
function fold(from: Map<string, MoveLink[]>, into: Map<string, MoveLink[]>, against: Map<string, MoveLink[]>): void {
  for (const [key, links] of from)
    if (against.has(key)) against.delete(key);
    else into.set(key, links);
}

/** The net of several edits in order: a move added then removed (or back again) is no change. */
export function netMoveChanges(steps: readonly MoveChanges[]): MoveChanges {
  const added = new Map<string, MoveLink[]>();
  const removed = new Map<string, MoveLink[]>();
  let annotated = 0;
  for (const step of steps) {
    fold(byKey(step.added), added, removed);
    fold(byKey(step.removed), removed, added);
    annotated += step.annotated;
  }
  return { added: [...added.values()].flat(), removed: [...removed.values()].flat(), annotated };
}
```

`isPlayerMove` comes from `./graph`. Add `repertoireGraphSchema` to `schema.ts`, building on the schemas already there:

```ts
export const repertoireGraphSchema = z.object({
  side: sideSchema,
  chapters: z.array(z.object({
    id: z.string().min(1),
    rootKey: z.string().min(1),
    intro: z.string().nullable(),
    nameSource: chapterNameSourceSchema,
  })),
  moves: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    san: z.string().min(1),
    uci: z.string().min(1),
    arrows: z.array(arrowSchema),
    circles: z.array(circleSchema),
    comment: z.string().nullable(),
    chapters: z.array(z.string().min(1)),
  })),
}) satisfies z.ZodType<RepertoireGraph>;
```

Export `graphChanges`, `playerMoveChanges`, `netMoveChanges`, `repertoireGraphSchema` and the types `GraphChanges`, `MoveChanges` and `MoveLink` from `src/index.ts`.

- [ ] **Step 4: Point db at it (backend-dev).**
  - In `write.ts`: `import type { GraphChanges, MoveLink } from '@mychess/chess'`, the parameter `diff: GraphChanges`, and `diff.annotatedMoves` where it read `diff.changedMoves`.
  - In `repository.ts`: `import { graphChanges } from '@mychess/chess'`, replacing both `diffRepertoire(` calls.
  - Delete `packages/db/src/repertoires/diff.ts` and `packages/db/test/repertoire-diff.test.ts`.

- [ ] **Step 5: Run.** Run `pnpm --filter @mychess/chess test` and then `pnpm --filter @mychess/db test -- repertoires`. Both are expected to pass. Report to the lead, which commits as `refactor(chess): graphChanges and repertoireGraphSchema in chess; player move changes (#277, S5 A1)`.

### Task A2: `allLearned` (chess-dev)

**Files:**
- Modify: `packages/chess/src/training/progress.ts`, `progress.test.ts`, `src/index.ts`

- [ ] **Step 1: Write the test.**

```ts
describe('allLearned (R-129)', () => {
  const g = italian; // the white graph progress.test.ts already builds
  const keys = playerKeys(g);
  it('is true when every player move is learned, opponent moves aside', () => {
    expect(allLearned(g, new Set(keys))).toBe(true);
  });
  it('is false when one player move is not learned', () => {
    expect(allLearned(g, new Set(keys.slice(1)))).toBe(false);
  });
  it('is true for a repertoire with no player moves (nothing to learn)', () => {
    expect(allLearned(emptyGraph('white'), new Set())).toBe(true);
  });
  it('ignores learned keys the repertoire does not hold', () => {
    expect(allLearned(g, new Set([...keys, 'x|y']))).toBe(true);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @mychess/chess test -- progress`. It should fail because `allLearned` is not exported.

- [ ] **Step 3: Implement.**

```ts
/**
 * Whether every player move of `graph` is learned (R-129: an Assignment is
 * done). `learned` holds the keys with a Review: the learn pass passed or
 * "I know this" (R-58). Nothing to learn counts as done.
 */
export function allLearned(graph: RepertoireGraph, learned: ReadonlySet<string>): boolean {
  return playerKeys(graph).every((k) => learned.has(k));
}
```

Export it from `src/index.ts`.

- [ ] **Step 4:** Run it and check it passes. Then add one reconciliation example for an assigned repertoire to the `reconcile` describe (C-M2-1). In `italian`, replace one player move with another via `removeMove` and `addMove`, and assert:
  - the new key is in `toLearn`;
  - the old key is in `dormant`;
  - every other key is in `kept`.

  Run it again. Report.

### Task A3: Calendar day and assignment rules (backend-dev) - SECURITY

**Files:**
- Create: `packages/domain/src/calendar.ts`, `calendar.test.ts`, `assignment.ts`, `assignment.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the tests.** `calendar.test.ts`:

```ts
describe('vilniusDay', () => {
  it('is the calendar day in Vilnius, not UTC', () => {
    expect(vilniusDay(new Date('2026-10-24T21:30:00Z'))).toBe('2026-10-25'); // UTC+3
    expect(vilniusDay(new Date('2026-12-24T22:30:00Z'))).toBe('2026-12-25'); // UTC+2
    expect(vilniusDay(new Date('2026-12-24T21:59:00Z'))).toBe('2026-12-24');
  });
});
```

`assignment.test.ts`, with the same `ok` and `refused` helpers as `coach-access.test.ts`:

```ts
const coaching = { coachSince: new Date('2026-10-01T00:00:00Z') };
const facts = (over: Partial<AssignFacts> = {}): AssignFacts => ({
  ...coaching, repertoireOwnerId: 'coach', targetAllowed: true, alreadyAssigned: false, ...over,
});
const player: AssignmentTarget = { kind: 'player', playerId: 'p1' };
const group: AssignmentTarget = { kind: 'group', groupId: 'g1' };

describe('canAssign', () => {
  it.each([
    ['allows the coach’s own repertoire to a linked player', player, facts(), ok],
    ['allows it to the coach’s own group', group, facts(), ok],
    ['refuses with Coach mode off', player, facts({ coachSince: null }), refused('assignment.notCoach')],
    ['refuses someone else’s repertoire', player, facts({ repertoireOwnerId: 'other' }), refused('assignment.notFound')],
    ['refuses a missing repertoire', player, facts({ repertoireOwnerId: undefined }), refused('assignment.notFound')],
    ['refuses an unlinked player', player, facts({ targetAllowed: false }), refused('assignment.notLinked')],
    ['refuses another coach’s group', group, facts({ targetAllowed: false }), refused('assignment.groupNotFound')],
    ['refuses a second assignment to the same target', group, facts({ alreadyAssigned: true }), refused('assignment.alreadyAssigned')],
  ])('%s', (_, target, f, expected) => {
    expect(canAssign('coach', target, f)).toStrictEqual(expected);
  });
  it('refuses assigning to oneself even if a link were claimed', () => {
    expect(canAssign('coach', { kind: 'player', playerId: 'coach' }, facts())).toStrictEqual(refused('assignment.notLinked'));
  });
});

describe('deadlineSchema', () => {
  it('accepts a calendar date and refuses anything else with a catalogue key', () => {
    expect(deadlineSchema.parse('2026-11-30')).toBe('2026-11-30');
    const bad = deadlineSchema.safeParse('30.11.2026');
    expect(bad.success ? null : bad.error.issues[0]?.message).toBe('assignment.deadlineInvalid');
  });
});

describe('effectiveDeadline', () => {
  it('takes the individual deadline over any group one (R-134)', () => {
    expect(effectiveDeadline({ individual: { deadline: '2026-12-01' }, groups: [{ deadline: '2026-11-01', joinedDay: '2026-10-01' }] })).toBe('2026-12-01');
  });
  it('takes an individual "no deadline" over a group deadline (R-134)', () => {
    expect(effectiveDeadline({ individual: { deadline: null }, groups: [{ deadline: '2026-11-01', joinedDay: '2026-10-01' }] })).toBeNull();
  });
  it('moves a group deadline to a later join day (R-16)', () => {
    expect(effectiveDeadline({ groups: [{ deadline: '2026-11-01', joinedDay: '2026-11-20' }] })).toBe('2026-11-20');
  });
  it('keeps a group deadline after the join day', () => {
    expect(effectiveDeadline({ groups: [{ deadline: '2026-11-01', joinedDay: '2026-10-20' }] })).toBe('2026-11-01');
  });
  it('takes the earliest of several groups’ deadlines, ignoring groups without one', () => {
    expect(effectiveDeadline({ groups: [
      { deadline: null, joinedDay: '2026-10-01' },
      { deadline: '2026-12-01', joinedDay: '2026-10-01' },
      { deadline: '2026-11-15', joinedDay: '2026-10-01' },
    ] })).toBe('2026-11-15');
  });
  it('is null with no deadline anywhere', () => {
    expect(effectiveDeadline({ groups: [{ deadline: null, joinedDay: '2026-10-01' }] })).toBeNull();
  });
});

describe('assignmentStatus', () => {
  const now = new Date('2026-11-02T10:00:00Z'); // 2 Nov in Vilnius
  const base = { deadline: '2026-11-01', done: false, paused: false, forked: false };
  it('is overdue from the day after the deadline (R-51)', () => {
    expect(assignmentStatus(base, now).overdue).toBe(true);
    expect(assignmentStatus({ ...base, deadline: '2026-11-02' }, now).overdue).toBe(false);
  });
  it('is never overdue when done (R-129)', () => {
    expect(assignmentStatus({ ...base, done: true }, now)).toStrictEqual({ overdue: false, paused: false, done: true, forked: false });
  });
  it('is overdue and paused at once (R-132)', () => {
    expect(assignmentStatus({ ...base, paused: true }, now)).toStrictEqual({ overdue: true, paused: true, done: false, forked: false });
  });
  it('is never overdue without a deadline', () => {
    expect(assignmentStatus({ ...base, deadline: null }, now).overdue).toBe(false);
  });
  it('shows only "forked" once the player forked (R-128)', () => {
    expect(assignmentStatus({ ...base, paused: true, forked: true }, now)).toStrictEqual({ overdue: false, paused: false, done: false, forked: true });
  });
});

describe('canUseAssignment and canFork', () => {
  it('lets a player use only an assignment they have and have not forked', () => {
    expect(canUseAssignment({ assigned: true, forked: false })).toStrictEqual(ok);
    expect(canUseAssignment({ assigned: false, forked: false })).toStrictEqual(refused('assignment.notFound'));
    expect(canUseAssignment({ assigned: true, forked: true })).toStrictEqual(refused('assignment.notFound'));
  });
  it('forks only a live assignment', () => {
    expect(canFork({ assigned: true, forked: false })).toStrictEqual(ok);
    expect(canFork({ assigned: true, forked: true })).toStrictEqual(refused('assignment.notFound'));
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- calendar assignment`. It should fail because the modules are missing.

- [ ] **Step 3: Implement.** `calendar.ts`:

```ts
/** The time zone dates are shown and decided in until accounts have one (CLAUDE.md). */
export const HOME_TIME_ZONE = 'Europe/Vilnius';

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOME_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The calendar day of `at` in Vilnius, as `YYYY-MM-DD` (plan decision 10). */
export const vilniusDay = (at: Date): string => DAY.format(at);
```

`assignment.ts`:

```ts
import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { isCoach, type CoachState } from './coach';
import { vilniusDay } from './calendar';

/** Message-catalogue keys for assignment refusals and issues. */
export const ASSIGNMENT_REFUSALS = {
  notCoach: 'assignment.notCoach',
  notFound: 'assignment.notFound',
  notLinked: 'assignment.notLinked',
  groupNotFound: 'assignment.groupNotFound',
  alreadyAssigned: 'assignment.alreadyAssigned',
  deadlineInvalid: 'assignment.deadlineInvalid',
} as const;

export interface AssignmentRefusal {
  readonly reason: (typeof ASSIGNMENT_REFUSALS)[keyof typeof ASSIGNMENT_REFUSALS];
}
type AssignmentResult = Result<undefined, AssignmentRefusal>;
const OK: AssignmentResult = { ok: true, value: undefined };
const refuse = (reason: AssignmentRefusal['reason']): AssignmentResult => ({ ok: false, refusal: { reason } });

/** Whom an Assignment gives a repertoire to (R-15, R-16). */
export type AssignmentTarget =
  | { readonly kind: 'player'; readonly playerId: string }
  | { readonly kind: 'group'; readonly groupId: string };

/** What canAssign decides on, read in the assigning transaction. */
export interface AssignFacts extends CoachState {
  /** The repertoire's owner; undefined when there is no such repertoire. */
  readonly repertoireOwnerId: string | undefined;
  /** A linked player, or one of this coach's groups. */
  readonly targetAllowed: boolean;
  readonly alreadyAssigned: boolean;
}

const targetRefusal = (t: AssignmentTarget) =>
  t.kind === 'player' ? ASSIGNMENT_REFUSALS.notLinked : ASSIGNMENT_REFUSALS.groupNotFound;

/**
 * A coach assigns only their own repertoire, only while in Coach mode, only
 * to a linked player or their own group, and once per target (plan
 * decision 1, lead decision 5). Someone else's repertoire reads as missing.
 */
export function canAssign(coachId: string, target: AssignmentTarget, facts: AssignFacts): AssignmentResult {
  if (!isCoach(facts)) return refuse(ASSIGNMENT_REFUSALS.notCoach);
  if (facts.repertoireOwnerId !== coachId) return refuse(ASSIGNMENT_REFUSALS.notFound);
  const self = target.kind === 'player' && target.playerId === coachId;
  if (self || !facts.targetAllowed) return refuse(targetRefusal(target));
  return facts.alreadyAssigned ? refuse(ASSIGNMENT_REFUSALS.alreadyAssigned) : OK;
}

/** A deadline: a calendar date (plan decision 10). */
export const deadlineSchema = z.iso.date({ error: ASSIGNMENT_REFUSALS.deadlineInvalid });

/** One group assignment as one member has it. */
export interface GroupDeadline {
  readonly deadline: string | null;
  /** The member's join day in Vilnius. */
  readonly joinedDay: string;
}

export interface DeadlineSources {
  readonly individual?: { readonly deadline: string | null };
  readonly groups: readonly GroupDeadline[];
}

const later = (a: string, b: string): string => (a > b ? a : b);

/**
 * The deadline a player has: the individual one if assigned individually
 * (R-134); otherwise each group deadline moved to the join day if later
 * (R-16), the earliest of them; null when none has a deadline.
 */
export function effectiveDeadline(sources: DeadlineSources): string | null {
  if (sources.individual !== undefined) return sources.individual.deadline;
  const dated = sources.groups.flatMap((g) => (g.deadline === null ? [] : [later(g.deadline, g.joinedDay)]));
  return dated.length === 0 ? null : dated.reduce((a, b) => (a < b ? a : b));
}

export interface AssignmentFacts {
  readonly deadline: string | null;
  /** Every player move learned (R-129, chess allLearned). */
  readonly done: boolean;
  readonly paused: boolean;
  readonly forked: boolean;
}

export interface AssignmentStatus {
  readonly overdue: boolean;
  readonly paused: boolean;
  readonly done: boolean;
  readonly forked: boolean;
}

const FORKED: AssignmentStatus = { overdue: false, paused: false, done: false, forked: true };

/** The badges a player and the coach see (R-51, R-128, R-129, R-132). */
export function assignmentStatus(facts: AssignmentFacts, now: Date): AssignmentStatus {
  if (facts.forked) return FORKED;
  const passed = facts.deadline !== null && vilniusDay(now) > facts.deadline;
  return { overdue: passed && !facts.done, paused: facts.paused, done: facts.done, forked: false };
}

/** A player's hold on one assigned repertoire, read fresh. */
export interface AssignmentHold {
  readonly assigned: boolean;
  readonly forked: boolean;
}

/**
 * A player opens, pauses or marks seen only a repertoire assigned to them
 * now and not forked (R-46, R-128); anything else reads as missing.
 */
export function canUseAssignment(hold: AssignmentHold): AssignmentResult {
  return hold.assigned && !hold.forked ? OK : refuse(ASSIGNMENT_REFUSALS.notFound);
}

/** A fork is of a live assignment the player has (R-20, R-128). */
export const canFork = canUseAssignment;
```

Export everything new from `src/index.ts`.

- [ ] **Step 4:** Run the tests and check they pass. Report.

### Task A4: Fork offer rules (backend-dev)

**Files:**
- Create: `packages/domain/src/fork-offer.ts`, `fork-offer.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the test.**

```ts
const created = new Date('2026-10-20T10:00:00Z');
const offer = (over: Partial<ForkOfferFacts> = {}): ForkOfferFacts => ({
  expiresAt: forkOfferExpiry(created), acceptedAt: null, declinedAt: null, closedAt: null, ...over,
});

describe('forkOfferExpiry', () => {
  it('is 30 days after the assignment ended (R-44)', () => {
    expect(forkOfferExpiry(created)).toEqual(new Date('2026-11-19T10:00:00Z'));
    expect(FORK_OFFER_DAYS).toBe(30);
  });
});

describe('forkOfferState', () => {
  const later = new Date('2026-10-25T00:00:00Z');
  it.each([
    ['open until it expires', offer(), later, 'open'],
    ['expired at its expiry', offer(), new Date('2026-11-19T10:00:00Z'), 'expired'],
    ['accepted', offer({ acceptedAt: later }), later, 'accepted'],
    ['declined', offer({ declinedAt: later }), later, 'declined'],
    ['closed when assigned again (lead decision 4)', offer({ closedAt: later }), later, 'closed'],
  ] as const)('%s', (_, o, now, state) => {
    expect(forkOfferState(o, now)).toBe(state);
  });
});

describe('canAnswerForkOffer', () => {
  it('answers only an open offer', () => {
    expect(canAnswerForkOffer(offer(), created)).toStrictEqual({ ok: true, value: undefined });
    expect(canAnswerForkOffer(offer({ declinedAt: created }), created)).toStrictEqual({ ok: false, refusal: { reason: 'forkOffer.notOpen' } });
  });
});

describe('FORK_OFFER_REASONS', () => {
  it('names each way an assignment ends', () => {
    expect(FORK_OFFER_REASONS).toStrictEqual(['unassigned', 'unlinked', 'leftGroup', 'deleted']);
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- fork-offer`. It should fail.

- [ ] **Step 3: Implement.**

```ts
import type { Result } from '@mychess/chess';

export const FORK_OFFER_DAYS = 30;
const DAY_MS = 86_400_000;

/** How an Assignment ended for the player (R-44, R-45, R-130, R-131). */
export const FORK_OFFER_REASONS = ['unassigned', 'unlinked', 'leftGroup', 'deleted'] as const;
export type ForkOfferReason = (typeof FORK_OFFER_REASONS)[number];

export const FORK_OFFER_REFUSALS = { notOpen: 'forkOffer.notOpen' } as const;
export interface ForkOfferRefusal {
  readonly reason: (typeof FORK_OFFER_REFUSALS)[keyof typeof FORK_OFFER_REFUSALS];
}

export interface ForkOfferFacts {
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly closedAt: Date | null;
}

export type ForkOfferState = 'open' | 'expired' | 'accepted' | 'declined' | 'closed';

/** When an offer made at `now` expires (R-44). */
export const forkOfferExpiry = (now: Date): Date => new Date(now.getTime() + FORK_OFFER_DAYS * DAY_MS);

export function forkOfferState(offer: ForkOfferFacts, now: Date): ForkOfferState {
  if (offer.acceptedAt !== null) return 'accepted';
  if (offer.declinedAt !== null) return 'declined';
  if (offer.closedAt !== null) return 'closed';
  return now < offer.expiresAt ? 'open' : 'expired';
}

/** A player keeps or declines only an open offer. */
export function canAnswerForkOffer(offer: ForkOfferFacts, now: Date): Result<undefined, ForkOfferRefusal> {
  return forkOfferState(offer, now) === 'open'
    ? { ok: true, value: undefined }
    : { ok: false, refusal: { reason: FORK_OFFER_REFUSALS.notOpen } };
}
```

Export these from `src/index.ts`.

- [ ] **Step 4:** Run the tests and check they pass. Report. The lead commits A2 to A4 as `feat(domain,chess): assignment, deadline and fork offer rules (S5 A2-A4) (#255)`.

---

## Part B: database

### Task B1: Assignment tables and migration (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/test/schema.test.ts`
- Create: the generated `packages/db/migrations/00NN_*.sql` and its snapshot

- [ ] **Step 1: Write the schema tests** in `schema.test.ts`, which runs against a migrated Testcontainers database, like the S4 constraint tests. Seed a coach C with a repertoire R, a linked player P, a group G of C with P in it, and a second coach D with a group H. Then assert:
  - **Exactly one target:** inserting `assignments` with both `player_id` and `group_id`, or with neither, fails with `assignments_one_target`.
  - **The coach's own repertoire:** an assignment of R by coach D fails with `assignments_repertoire_fk`.
  - **Only linked players:** an assignment by C to an unlinked account fails with `assignments_link_fk`.
  - **Only the coach's own groups:** an assignment by C to D's group H fails with `assignments_group_fk`.
  - **Once per target:** a second assignment of R to P, or to G, fails with a unique violation.
  - **Cascades:**
    - deleting the `coach_links` row deletes the player assignment;
    - deleting G deletes the group assignment;
    - deleting R deletes both, plus R's `repertoire_changes` and `assignment_players` rows;
    - deleting R sets `fork_offers.repertoire_id` to null and keeps the offer.
  - **Fork notes:** deleting the fork repertoire deletes its `fork_coach_notes`.

- [ ] **Step 2:** Run `pnpm --filter @mychess/db test -- schema`. It should fail because the tables do not exist.

- [ ] **Step 3: Add the tables** after `coachNotes` in `schema.ts`. Import `date` from `drizzle-orm/pg-core`, `FORK_OFFER_REASONS` from `@mychess/domain`, and `MoveChanges` and `RepertoireGraph` (types) from `@mychess/chess`.

```ts
/**
 * A coach's Assignment of their own repertoire to one linked player or one
 * of their groups (R-15, R-16; plan decision 1). Every foreign key cascades,
 * so unlinking, deleting the group or deleting the repertoire ends it in the
 * same statement; changeAssignments writes the fork offers first.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id').notNull(),
    repertoireId: uuid('repertoire_id').notNull(),
    playerId: text('player_id'),
    groupId: uuid('group_id'),
    /** A calendar date (plan decision 10); null for none. */
    deadline: date('deadline', { mode: 'string' }),
    /** The repertoire's version when assigned (plan decision 2). */
    assignedVersion: integer('assigned_version').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    check('assignments_one_target', sql`(${t.playerId} is null) <> (${t.groupId} is null)`),
    foreignKey({
      name: 'assignments_repertoire_fk',
      columns: [t.repertoireId, t.coachId],
      foreignColumns: [repertoires.id, repertoires.ownerAccountId],
    }).onDelete('cascade'),
    // MATCH SIMPLE: checked only for a player target.
    foreignKey({
      name: 'assignments_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    // MATCH SIMPLE: checked only for a group target.
    foreignKey({
      name: 'assignments_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    uniqueIndex('assignments_player_unique').on(t.repertoireId, t.playerId).where(sql`${t.playerId} is not null`),
    uniqueIndex('assignments_group_unique').on(t.repertoireId, t.groupId).where(sql`${t.groupId} is not null`),
    index('assignments_link_idx').on(t.coachId, t.playerId),
    index('assignments_group_idx').on(t.groupId),
  ],
);

/** A player's own state on a repertoire they have by assignment (plan decision 4). */
export const assignmentPlayers = pgTable(
  'assignment_players',
  {
    playerId: text('player_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id').notNull().references(() => repertoires.id, { onDelete: 'cascade' }),
    /** R-46. */
    pausedAt: at('paused_at'),
    /** The version the player last opened (R-133). */
    seenVersion: integer('seen_version'),
    /** R-128: the player forked it; the coach sees "forked". */
    forkedAt: at('forked_at'),
  },
  (t) => [
    primaryKey({ name: 'assignment_players_pk', columns: [t.playerId, t.repertoireId] }),
    index('assignment_players_repertoire_idx').on(t.repertoireId),
  ],
);

/** What one graph edit changed for players (R-133; plan decision 3). */
export const repertoireChanges = pgTable(
  'repertoire_changes',
  {
    repertoireId: uuid('repertoire_id').notNull().references(() => repertoires.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    changes: jsonb('changes').$type<MoveChanges>().notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [primaryKey({ name: 'repertoire_changes_pk', columns: [t.repertoireId, t.version] })],
);

/**
 * A 30-day offer to keep a copy of an Assignment that ended (R-44, R-45,
 * R-130, R-131). The snapshot is taken when it ends (lead decision 3), so
 * it outlives the repertoire and the coach.
 */
export const forkOffers = pgTable(
  'fork_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id').references(() => repertoires.id, { onDelete: 'set null' }),
    coachName: text('coach_name').notNull(),
    name: text('name').notNull(),
    side: text('side', { enum: SIDES }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    reason: text('reason', { enum: FORK_OFFER_REASONS }).notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    acceptedAt: at('accepted_at'),
    declinedAt: at('declined_at'),
    closedAt: at('closed_at'),
    forkId: uuid('fork_id').references(() => repertoires.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('fork_offers_reason_check', oneOf(t.reason, FORK_OFFER_REASONS)),
    check('fork_offers_side_check', oneOf(t.side, SIDES)),
    index('fork_offers_player_idx').on(t.playerId),
    index('fork_offers_repertoire_idx').on(t.repertoireId),
  ],
);

/** A coach's comments kept read-only in a player's fork (R-47, R-49; plan decision 7). */
export const forkCoachNotes = pgTable(
  'fork_coach_notes',
  {
    repertoireId: uuid('repertoire_id').notNull().references(() => repertoires.id, { onDelete: 'cascade' }),
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    coachName: text('coach_name').notNull(),
  },
  (t) => [primaryKey({ name: 'fork_coach_notes_pk', columns: [t.repertoireId, t.moveKey] })],
);
```

- [ ] **Step 4: Generate the migration** with `pnpm --filter @mychess/db db:generate`. Read the SQL and check three things:
  - the two partial unique indexes have their `WHERE` clause;
  - every foreign key has the intended `ON DELETE`;
  - nothing else changed.

- [ ] **Step 5:** Run `pnpm --filter @mychess/db test -- schema` and check it passes. Report the migration file name. The lead commits it as `feat(db): assignment, fork offer and change tables (S5 B1) (#255)`.

### Task B2: Effective assignments and `changeAssignments` (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/effective.ts`, `change.ts`, `snapshot.ts`
- Test: `packages/db/test/assignments.test.ts`

- [ ] **Step 1: Write the tests**, using the db test helpers already used by `groups.test.ts`. The seed is coach C (Coach mode on), players P, Q and N, all linked to C, group G with P and Q, and C's repertoire R. Assignments are inserted directly here, because B3 adds `assign`:
  - `effectiveAssignments(db, P)` lists R once when R is assigned both to G and to P individually. The result carries the individual deadline and the group deadline with P's join day.
  - `effectiveAssignments(db, N)` is empty: N is not in G.
  - A row in `assignment_players` with `forked_at` set removes R from `effectiveIds(db, P)`. It still appears in `effectiveAssignments(db, P, { withForked: true })`.
  - `changeAssignments(tx, { playerIds: [P], reason: 'leftGroup', now }, () => delete P from G)` writes one fork offer for P and R, with:
    - `coach_name` = C's display name;
    - `name` and `side` = R's;
    - `reason` = `leftGroup`;
    - `expires_at` = now + 30 days;
    - a snapshot whose graph equals R's graph and whose `personalNotes` holds P's personal note on R.
  - The same change for a player who also has R individually writes no offer.
  - Removing a membership through `changeAssignments` deletes P's `assignment_players` row for R once no assignment row reaches P.
  - Re-adding P to G through `changeAssignments` sets `closed_at` on P's open offer for R.
  - A forked player who loses the assignment gets no offer.

- [ ] **Step 2:** Run `pnpm --filter @mychess/db test -- assignments`. It should fail because the modules are missing.

- [ ] **Step 3: Implement `effective.ts`.**

```ts
/**
 * A player's assignments derived from the rows (plan decision 1): the
 * individual ones, and every group's the player is in. One entry per
 * repertoire. Internal to the package; repositories build on it.
 */
import { vilniusDay, type DeadlineSources } from '@mychess/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { assignmentPlayers, assignments, groupMembers } from '../schema';

export interface EffectiveAssignment {
  readonly repertoireId: string;
  readonly coachId: string;
  readonly sources: DeadlineSources;
  /** The lowest assigned_version among its rows. */
  readonly assignedVersion: number;
  readonly pausedAt: Date | null;
  readonly seenVersion: number | null;
  readonly forkedAt: Date | null;
}

const rowSchema = z.object({
  repertoireId: z.uuid(),
  coachId: z.string().min(1),
  deadline: z.iso.date().nullable(),
  assignedVersion: z.number().int(),
  joinedAt: z.date().nullable(),
});
type Row = z.infer<typeof rowSchema>;

const stateSchema = z.object({
  repertoireId: z.uuid(),
  pausedAt: z.date().nullable(),
  seenVersion: z.number().int().nullable(),
  forkedAt: z.date().nullable(),
});

const columns = {
  repertoireId: assignments.repertoireId,
  coachId: assignments.coachId,
  deadline: assignments.deadline,
  assignedVersion: assignments.assignedVersion,
};

async function rowsOf(db: Executor, playerId: string): Promise<Row[]> {
  const individual = await db.select({ ...columns, joinedAt: sqlNull }).from(assignments).where(eq(assignments.playerId, playerId));
  const viaGroups = await db
    .select({ ...columns, joinedAt: groupMembers.joinedAt })
    .from(assignments)
    .innerJoin(groupMembers, eq(groupMembers.groupId, assignments.groupId))
    .where(eq(groupMembers.playerId, playerId));
  return z.array(rowSchema).parse([...individual, ...viaGroups]);
}
```

`sqlNull` is ``sql<Date | null>`null::timestamptz` ``, declared at the top of the file. The rest of the module:

- `group(rows)` folds the rows by `repertoireId`:
  - a row with `joinedAt === null` is the individual source;
  - every other row becomes a `GroupDeadline` with `joinedDay: vilniusDay(joinedAt)`;
  - the result keeps the minimum `assignedVersion`.
- `effectiveAssignments(db, playerId, { withForked = false } = {})` reads the rows and the player's `assignment_players` rows for those repertoires (`inArray`). It merges them and, unless `withForked` is set, drops those with `forkedAt` set.
- `effectiveIds(db, playerId)` returns the `Set` of non-forked repertoire ids.

Keep each function under complexity 10. Split `group` into `toSource` and the fold if needed.

- [ ] **Step 4: Implement `snapshot.ts`.**

```ts
import { repertoireGraphSchema } from '@mychess/chess';
import { z } from 'zod';

/** What a fork offer keeps (plan decision 6). */
export const snapshotSchema = z.object({
  graph: repertoireGraphSchema,
  personalNotes: z.array(z.object({ moveKey: z.string().min(1), text: z.string() })),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
```

`takeSnapshot(tx, playerId, repertoireId)` loads the repertoire with `loadRepertoireRows(tx, eq(repertoires.id, repertoireId))` and the player's `personal_notes` on it, and returns `{ repertoire, snapshot }`. It returns undefined if the repertoire is gone; deletes snapshot first (decision 5), so that never happens in practice.

- [ ] **Step 5: Implement `change.ts`.**

```ts
/**
 * The one way assignments are taken from or given back to players (plan
 * decision 5): reads who has what, runs `change`, reads again, writes a
 * 30-day fork offer per lost repertoire and closes the offer of each one
 * regained. Call it inside the transaction that makes the change.
 */
export interface AssignmentChange {
  readonly playerIds: readonly string[];
  readonly reason: ForkOfferReason;
  readonly now: Date;
}

export async function changeAssignments<T>(
  tx: Tx,
  { playerIds, reason, now }: AssignmentChange,
  change: () => Promise<T>,
): Promise<T> {
  const before = await idsOf(tx, playerIds);
  const result = await change();
  const after = await idsOf(tx, playerIds);
  for (const playerId of playerIds) {
    const had = before.get(playerId) ?? new Set<string>();
    const has = after.get(playerId) ?? new Set<string>();
    for (const id of had) if (!has.has(id)) await offerFork(tx, playerId, id, reason, now);
    for (const id of has) if (!had.has(id)) await closeOffers(tx, playerId, id, now);
    await dropStaleState(tx, playerId);
  }
  return result;
}
```

The helpers:
- `idsOf` maps each player to `effectiveIds`.
- `offerFork` calls `takeSnapshot` and inserts the `fork_offers` row. `coach_name` comes from the repertoire owner's `accounts.display_name`, and `expires_at` from `forkOfferExpiry(now)`.
- `closeOffers` runs `update fork_offers set closed_at = now where player_id = P and repertoire_id = R and accepted_at is null and declined_at is null and closed_at is null and expires_at > now`.
- `dropStaleState` deletes `assignment_players` rows of P whose repertoire no longer reaches P through any `assignments` row (forked included, using `effectiveAssignments(tx, P, { withForked: true })`).

If the nested loop goes over complexity 10, split it into `settlePlayer(tx, playerId, had, has, reason, now)`.

- [ ] **Step 6:** Run `pnpm --filter @mychess/db test -- assignments` and check it passes. Report.

### Task B3: Assign, unassign, deadlines; routing the existing changes (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/assign.ts`
- Modify: `packages/db/src/coaching.ts` (`unlink`), `groups.ts` (`addMember`, `removeMember`, `leaveGroup`, `deleteGroup`), `invites.ts` (`acceptInvite`'s membership insert), `repertoires/repository.ts` (`deleteRepertoire`), `src/index.ts`
- Test: `packages/db/test/assignments.test.ts`, `groups.test.ts`, `coaching.test.ts`, `invites.test.ts`, `repertoires.test.ts`

- [ ] **Step 1: Write the tests.**
  - **`assign(db, { coachId, repertoireId, target, deadline }, now)`**, with an `AssignRequest` type:
    - returns `ok` and inserts one row with `assigned_version` = R's version;
    - refuses with each `canAssign` reason (Coach mode off, another coach's repertoire, an unlinked player, another coach's group, assigned twice), and writes nothing;
    - closes P's open fork offer for R (C-M1-6);
    - clears P's `forked_at` (decision 8).
  - **Group inheritance (R-16):** after `assign` to G, N is added to G with `addMember`, and `effectiveIds(db, N)` contains R.
  - **`unassign(db, { coachId, assignmentId }, now)`:**
    - deletes the row and writes one `unassigned` offer per player who lost R (R-130);
    - a member who also has R individually gets none;
    - another coach's assignment id is refused with `assignment.notFound` and nothing changes.
  - **`setDeadline(db, { coachId, assignmentId, deadline: '2026-11-30' | null })`** updates only the coach's own row (R-51 extend or clear).
  - **`unlink(db, C, P)`:** after it, P has an `unlinked` offer for R and the assignment rows are gone.
  - **Group membership changes:**
    - `leaveGroup` and `removeMember` write a `leftGroup` offer (R-45);
    - `deleteGroup` writes one for each member;
    - `addMember` and an `acceptInvite` that names G each close an open offer.
  - **`deleteRepertoire(db, R, C)`** writes `deleted` offers for every player, and the offers keep their snapshot after the repertoire is gone (R-131).

- [ ] **Step 2:** Run the tests and check they fail.

- [ ] **Step 3: Implement `assign.ts`.** Each function is one transaction.

```ts
export interface AssignRequest {
  /** The session account. */
  readonly coachId: string;
  readonly repertoireId: string;
  readonly target: AssignmentTarget;
  /** Already parsed by deadlineSchema; null for none. */
  readonly deadline: string | null;
}

export function assign(db: Db, req: AssignRequest, now: Date): Promise<Result<undefined, AssignmentRefusal>> {
  return db.transaction(async (tx) => {
    const coach = await lockAccountById(tx, req.coachId); // S4 lock order: coach row first
    const repertoire = await holdRepertoire(tx, req.repertoireId); // { ownerId, version } | undefined, FOR KEY SHARE
    const allowed = canAssign(req.coachId, req.target, {
      coachSince: coach?.coachSince ?? null,
      repertoireOwnerId: repertoire?.ownerId,
      targetAllowed: await targetAllowed(tx, req.coachId, req.target), // holdLink or holdGroup (coach-queries.ts)
      alreadyAssigned: await isAssigned(tx, req.repertoireId, req.target),
    });
    if (!allowed.ok || repertoire === undefined) return allowed.ok ? refusal(ASSIGNMENT_REFUSALS.notFound) : allowed;
    const players = await reachedBy(tx, req.coachId, req.target); // [playerId] or the group's members
    await changeAssignments(tx, { playerIds: players, reason: 'unassigned', now }, async () => {
      await tx.insert(assignments).values({ ...targetColumns(req.target), coachId: req.coachId, repertoireId: req.repertoireId, deadline: req.deadline, assignedVersion: repertoire.version, createdAt: now });
      await clearForks(tx, players, req.repertoireId); // decision 8
    });
    return DONE;
  });
}
```

The other functions:
- `unassign` locks the row with `select ... for update where id = :id and coach_id = :coach`, so another coach's id reads as `notFound`. It runs the delete inside `changeAssignments` with `reachedBy`'s players and reason `unassigned`.
- `unassignAll(tx, repertoireId, reason, now)` does the same for every row of the repertoire, with reason `deleted`. `deleteRepertoire` calls it before its delete, inside one transaction; wrap the existing delete in `db.transaction`.
- `setDeadline` is an `update ... where id and coach_id`, and returns `notFound` when 0 rows change.

- [ ] **Step 4: Route the existing changes** through `changeAssignments`. Each needs only the wrapper, with the player list read before the change:
  - `unlink`: wrap in `db.transaction`, players `[playerId]`, reason `unlinked`.
  - `leaveGroup` and `removeMember`: `[playerId]`, `leftGroup`. `leaveGroup` gains a transaction.
  - `deleteGroup`: the group's members (select before the delete), `leftGroup`.
  - `addMember`, and `acceptInvite` where it inserts a membership: `[playerId]`, reason `leftGroup`. The reason is unused there, because only regains happen.

  Keep the S4 lock order: coach row, then invite, then the rest. `changeAssignments` takes no locks of its own.

- [ ] **Step 5:** Run `pnpm --filter @mychess/db test` and check it passes, the S4 suites included. Report.

### Task B4: Player reads, pause, seen, changes (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/player.ts`
- Modify: `packages/db/src/repertoires/repository.ts` (`saveRepertoireEdit` writes `repertoire_changes`), `src/index.ts`
- Test: `packages/db/test/assignments.test.ts`, `repertoires.test.ts`

- [ ] **Step 1: Write the tests.**
  - **`repertoire_changes` rows:**
    - `saveRepertoireEdit` with an added player move writes a row whose `changes` equals `playerMoveChanges(before, after)` and whose `version` is the new version;
    - a chapter rename writes no row;
    - a comment edit writes one with `annotated: 1`.
  - **`playerAssignments(db, P, now)`** returns, per effective non-forked repertoire:
    - `{ repertoireId, name, side, coachId, coachName, deadline, paused, updated, done }`;
    - `deadline` comes from `effectiveDeadline`;
    - `updated` is true after a coach edit and false after `markSeen`;
    - `done` comes from `allLearned(graph, learned)` with `learned` empty until S6, so it is true only for a repertoire without player moves.
  - **`assignedRepertoireForPlayer(db, P, R)`:**
    - returns `{ repertoire, graph, coachName, personalNotes }` for an effective non-forked R;
    - returns undefined for an R not assigned to P, a forked R, or any other id (checked by the query, not only the domain);
    - comments come with the graph, as coach notes (R-102).
  - **`pauseAssignment(db, { playerId, repertoireId, paused }, now)`:**
    - sets and clears `paused_at` on P's own effective assignment;
    - refuses with `assignment.notFound` for one that is not P's;
    - `trainingRepertoires(db, P)` then lists R with `active: false` (R-46).
  - **`markSeen(db, P, R)`** sets `seen_version` to R's version.
  - **`changesSince(db, P, R)`** returns `netMoveChanges` of the rows after `coalesce(seen_version, assigned_version)`, in version order, with chapter names resolved from the current graph for the summary.
  - **`trainingRepertoires(db, P)`:**
    - lists P's own repertoires (`active: true`) and their effective non-forked assigned ones;
    - a forked one is absent, and the fork itself appears as an own repertoire.
  - **`openForkOffers(db, P, now)`** lists open offers only (`forkOfferState === 'open'`), newest first, with the days left.

- [ ] **Step 2:** Run the tests and check they fail.

- [ ] **Step 3: Implement.** Every function filters by `playerId` and through `effectiveAssignments`, so the query itself enforces access (CLAUDE.md "enforced again in queries"). In `saveRepertoireEdit`, after `writeDiff`:

```ts
const changes = playerMoveChanges(before, edit.after);
if (changes.added.length + changes.removed.length + changes.annotated > 0)
  await tx.insert(repertoireChanges).values({ repertoireId: edit.id, version: row.version, changes, createdAt: edit.now });
```

Parse `repertoire_changes.changes` with a zod `moveChangesSchema` (`added` and `removed` as arrays of `{ moveKey, chapterId }`, `annotated` an int) before use. Export the new functions and their types from `src/index.ts`.

- [ ] **Step 4:** Run `pnpm --filter @mychess/db test` and check it passes. Report.

### Task B5: Forks, fork offers, auto-fork on coach delete (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/fork.ts`, `packages/db/test/forks.test.ts`
- Modify: `packages/db/src/accounts.ts` (`deleteAccount`), `account-export.ts`, `src/index.ts`

- [ ] **Step 1: Write the tests.**
  - **`forkAssignment(db, { playerId: P, repertoireId: R }, now)`:**
    - creates a repertoire owned by P with R's chapters and moves, all comments null;
    - writes one `fork_coach_notes` row per commented move, with C's display name;
    - copies P's personal notes;
    - sets `forked_at`.
    - After it, `effectiveIds(db, P)` lacks R and `trainingRepertoires` has the fork.
    - R is unchanged.
    - Forking again is refused with `assignment.notFound`.
  - **`acceptForkOffer(db, { playerId, offerId }, now)`:**
    - builds the fork from the offer's snapshot, and works after R is deleted;
    - sets `accepted_at` and `fork_id`;
    - another player's offer id is `forkOffer.notOpen`, with nothing written;
    - an expired, declined or closed one is also `forkOffer.notOpen`.
  - **`declineForkOffer`** sets `declined_at`, and only on the player's own open offer.
  - **`forkCoachNotesOn(db, P, forkId)`** returns `{ moveKey, text, coachName }[]`, only for P's own repertoire.
  - **R-49:**
    - `deleteAccount(db, C)` leaves P (individual) and Q (through G) each a fork of R, with C's notes as fork notes;
    - a player who had already forked gets no second fork;
    - the forks survive C's cascade.
  - **Data export (`exportAccount`):** a player's export lists their forks as repertoires (already true) and their fork coach notes. Coach notes on others' forks are never in a coach's export (R-126 analogue).

- [ ] **Step 2:** Run the tests and check they fail.

- [ ] **Step 3: Implement.** `writeFork(tx, { playerId, name, side, graph, personalNotes, coachName, now })`:
  - calls `createRepertoire` on `tx` with the graph's comments set to null;
  - inserts `fork_coach_notes` for each move with a comment (`moveKey(m.from, m.san)`);
  - inserts the personal notes;
  - returns the new id.

`forkAssignment` checks `canFork` against `effectiveAssignments(tx, P, { withForked: true })`, takes the snapshot of the live R, calls `writeFork`, and upserts `assignment_players.forked_at = now`.

`acceptForkOffer` locks the offer (`for update where id and player_id`), checks `canAnswerForkOffer`, parses the snapshot with `snapshotSchema`, calls `writeFork`, and sets `accepted_at` and `fork_id`.

In `deleteAccount`, before `tx.delete(accounts)`:

```ts
// R-49: a deleting coach's players keep what they were assigned.
for (const { playerId, repertoireId } of await liveAssigneesOfCoach(tx, id, now))
  await forkAssignment(tx, { playerId, repertoireId }, now);
```

`liveAssigneesOfCoach` gives every (player, repertoire) where the repertoire is owned by `id` and in the player's `effectiveIds`. `forkAssignment` and `writeFork` take an `Executor` and nest as savepoints when called on a `Tx`. Update the doc comment of `deleteAccount` to name the S5 rows.

- [ ] **Step 4:** Run `pnpm --filter @mychess/db test` and check it passes. Report. The lead commits B2 to B5 as `feat(db): assignments, fork offers, forks and coach-delete auto-fork (S5 B2-B5) (#255)`.

### Task B6: Coach reads (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/assignments/coach.ts`
- Modify: `src/index.ts`, `test/assignments.test.ts`

- [ ] **Step 1: Write the tests.**
  - `coachAssignments(db, C, R, now)` returns one entry per assignment row:
    - `{ id, target: { kind, id, name }, deadline, players }`;
    - `players` is each player it reaches: `{ playerId, displayName, deadline (effective for that player), paused, forked, done }`.
  - It returns `[]` for another coach's R.
  - The view only covers players linked now: after `unlink`, P is gone from it.
  - `assignedPlayerCount(db, C, R)` counts the distinct players with R through any row, for the delete dialog (R-131).

- [ ] **Step 2:** Run the tests and check they fail. Then implement, filtering on `assignments.coach_id = C` and `repertoires.owner_account_id = C`. Then run them and check they pass. Report.

---

## Part C: web

### Task C1: One repertoire-view module (#283) (web-dev) - UX

**Files:**
- Create: `apps/web/src/app/repertoire-view/repertoire-shell.tsx`, `position-body.tsx`, `index.ts`, and their tests
- Modify: `apps/web/src/app/repertuarai/[id]/repertoire-screen.tsx`, `move-panel.tsx`, `apps/web/src/app/treneris/zaidejai/[playerId]/repertuarai/[repertoireId]/shared-repertoire-view.tsx`

- [ ] **Step 1: Write the tests.**
  - `RepertoireShell` renders a header slot, the board row, the chapter list and a side panel slot. Give it a role and a heading test, using the existing `repertoire-screen.test.tsx` expectations as the model.
  - `PositionBody` renders the move list and the position's comment, plus a `notes` render prop:

    ```ts
    notes?: (moveKey: string) => ReactNode
    ```

    It shows nothing when the prop is absent.

- [ ] **Step 2: Implement it** by moving code, not rewriting it:
  - the layout from `repertoire-screen.tsx:331-364`;
  - `PanelStatus` and `PanelBody`;
  - `MovePanel`'s position body (`move-panel.tsx:389-401`) into `PositionBody`.

  `MovePanel` keeps the owner's `CoachNotes` and `PersonalNote` and passes them through `notes`. `shared-repertoire-view.tsx` drops its copied ~70 lines and its 11 deep imports, and imports only from `../../../../repertoire-view`.

- [ ] **Step 3:** Run `pnpm --filter @mychess/web test:component`. Everything should pass, the S3 and S4 screen tests unchanged. The behaviour is the same. Report. The lead closes #283 with the commit.

### Task C2: Coach's "Assign" panel (web-dev) - SECURITY - UX

**Files:**
- Create: `apps/web/src/app/repertuarai/[id]/assign-panel.tsx`, `assign-panel.test.tsx`, `assign-actions.ts`, `apps/web/src/server/assignment-input.ts`, `assignment-input.test.ts`
- Modify: `apps/web/src/app/repertuarai/[id]/page.tsx` (load `coachAssignments`, `coachPlayers`, `coachGroups` when the owner is a coach), `repertoire-header.tsx` (the delete dialog count), `src/i18n/messages/{lt,en}.json`

- [ ] **Step 1: Write the tests.**

  `assignment-input.ts` schemas, tested in `assignment-input.test.ts`:

  ```ts
  export const assignInputSchema = z.object({
    repertoireId: z.uuid(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('player'), playerId: accountIdSchema }),
      z.object({ kind: z.literal('group'), groupId: z.uuid() }),
    ]),
    deadline: z.union([deadlineSchema, z.literal('')]).transform((d) => (d === '' ? null : d)),
  });
  export const assignmentIdSchema = z.object({ assignmentId: z.uuid() });
  export const deadlineInputSchema = assignmentIdSchema.extend({
    deadline: z.union([deadlineSchema, z.literal('')]).transform((d) => (d === '' ? null : d)),
  });
  ```

  `assign-panel.test.tsx` covers the panel:
  - **Unassigned repertoire:** shows "Priskirti" with a picker of linked players and groups and an optional date field.
  - **The assignment list:** each row shows its target, with each player's badges (paused, overdue, forked) from `assignmentStatus`.
  - **Row actions:** "Change deadline", "Clear deadline", and "Unassign" behind a `ConfirmedAction`.
  - **A refusal value** renders through `RefusalLine` (`apps/web/src/app/treneris/refusal-line.tsx`).
  - **Coach mode off:** the panel is not shown at all.

- [ ] **Step 2: Implement.** `assign-actions.ts` has `assignAction`, `unassignAction` and `setDeadlineAction`. Each works the same way:
  - `const coach = await requireCoach()`;
  - parse with the schema (a parse failure becomes a refusal with the zod issue key);
  - call the db function with `coachId: coach.id`;
  - `revalidatePath(repertoireRoute(id))`.

  The page gets `assignedPlayerCount` for the delete dialog, whose text is something like "Šį repertuarą turi 3 žaidėjai; jie galės pasilikti kopiją 30 dienų".

  Add LT and EN messages under `assignment.*`, using the glossary terms: priskirti, terminas, asmeninė kopija. i18n-content reviews them in C6.

- [ ] **Step 3:** Run `pnpm --filter @mychess/web test:component` and check it passes. Report.

### Task C3: Player home: "From my coach" and fork offers (web-dev) - SECURITY - UX

**Files:**
- Create: `apps/web/src/app/from-my-coach.tsx`, `from-my-coach.test.tsx`, `fork-offers.tsx`, `fork-offers.test.tsx`, `apps/web/src/app/fork-offer-actions.ts`
- Modify: `apps/web/src/app/page.tsx`, `home-view.tsx`, `src/lib/routes.ts` (`assignedRepertoirePath`), messages

- [ ] **Step 1: Write the tests.**
  - **"From my coach"** lists each assignment:
    - its name links to `assignedRepertoirePath(id)`;
    - the coach's name;
    - the deadline in Vilnius time (format it with `DISPLAY_TIME_ZONE`);
    - the badges: "Pavėluota" when overdue, "Pristabdyta" when paused, "Atnaujinta" when updated.
  - **No assignments:** the section is not rendered.
  - **Fork offers** list each open offer:
    - its name, the coach's name and the days left;
    - "Pasilikti kopiją" (keep a copy) and "Ne, ačiū" (no, thanks).

    Keeping one goes to the new fork's page, through `repertoireRoute(forkId)`.

- [ ] **Step 2: Implement.** `page.tsx` loads `playerAssignments` and `openForkOffers` for the session account, and passes `assignmentStatus` results in. `fork-offer-actions.ts` has `acceptForkOfferAction` and `declineForkOfferAction`, with the session player, `z.object({ offerId: z.uuid() })`, and the db call.

- [ ] **Step 3:** Run the tests and check they pass. Report.

### Task C4: The assigned repertoire page (web-dev) - SECURITY - UX

**Files:**
- Create: `apps/web/src/app/repertuarai/priskirti/[id]/page.tsx`, `assigned-view.tsx`, `assigned-view.test.tsx`, `changes-summary.tsx`, `changes-summary.test.tsx`, `actions.ts`, `loading.tsx`, `not-found.tsx`
- Create: `apps/web/src/server/assignment-pages.ts`

- [ ] **Step 1: Write the tests.**
  - **`assignedRepertoireData(rawId)`:**
    - parses the id with `z.uuid()`;
    - loads `assignedRepertoireForPlayer` for the session account;
    - answers `notFound()` when there is no result.
  - **`AssignedView`** is built on the C1 module. It shows:
    - the board, read-only, with no builder controls;
    - the comments, under "Trenerio pastaba — {coach}";
    - the player's personal note (the S3 `PersonalNote`, which the player can edit, R-21);
    - "Pristabdyti" or "Tęsti" (pause or resume);
    - "Pasidaryti asmeninę kopiją" (make my own copy) behind a `ConfirmedAction`. Its text says coach edits will no longer reach the copy (R-128).
  - **`ChangesSummary`:**
    - while `updated` is true, it lists the added and removed moves by chapter name (SAN with move numbers, using the existing move-label helper) and "N komentarų pakeista";
    - it renders nothing when there are no changes.
  - **Opening the page** calls `markSeen` after the data is read, so the summary shows once (R-133).

- [ ] **Step 2: Implement.** `actions.ts` has `pauseAction`, `forkAction` and `setPersonalNoteAction`, which reuses `setPersonalNote`. Each action:
  - takes the player from the session;
  - checks `canUseAssignment` or `canFork` with facts read by the db function;
  - after a fork, redirects to `repertoireRoute(forkId)`.

  A forked repertoire's page (`/repertuarai/[id]`) shows `forkCoachNotesOn` as read-only "Trenerio pastaba — {name}" notes, through the C1 `notes` slot.

- [ ] **Step 3:** Run the tests and check they pass. Report. The lead commits C1 to C4 in two commits:
  - `refactor(web): one repertoire-view module (#283)`;
  - `feat(web): assign, from my coach, fork offers and the assigned repertoire page (S5 C2-C4) (#255)`.

### Task C5: Feature tests for access (qa with web-dev) - SECURITY

**Files:**
- Create: `apps/web/test/feature/assignments.test.ts`

- [ ] **Step 1: Write the tests** with the #266 harness (see `sharing.test.ts` for the setup). Each case asserts what it shows and that nothing in the database changed:
  - **`assignAction` refusals:**
    - another account's repertoire is `assignment.notFound`;
    - an unlinked player is `assignment.notLinked`;
    - another coach's group is `assignment.groupNotFound`;
    - an account with Coach mode off is `assignment.notCoach`.
  - **Wrong coach:** `unassignAction` and `setDeadlineAction` with another coach's assignment id change nothing.
  - **Assigned page access:** `/repertuarai/priskirti/[id]` is 404 for:
    - an account it is not assigned to;
    - the same player after unassign, after unlink, after leaving the group, and after forking;
    - a malformed id.
  - **Wrong player:** `pauseAction`, `forkAction` and the fork offer actions with someone else's ids change nothing.
  - **Forged form fields:** a `coachId` or `playerId` added to any form is ignored.
  - **Coach notes on the coach's own repertoire** are visible to the assigned player and to no one else.

- [ ] **Step 2:** Run `pnpm --filter @mychess/web test:feature -- assignments` and check it passes. Report.

### Task C6: Lithuanian and English review (i18n-content) - UX

- [ ] Review every new `assignment.*`, `forkOffer.*` and `home.fromMyCoach.*` message. Record the settled terms in `docs/glossary-lt.md`:
  - Assignment (priskyrimas);
  - Deadline (terminas);
  - Overdue;
  - Paused;
  - Updated;
  - Fork ("asmeninė kopija"; settle the open EN word in item 5 of the glossary);
  - Fork offer.

  New terms go to the owner as a ruling proposal through the lead, as in R-127.

### Task C7: Visual sign-off (ux-designer) - UX

- [ ] Screenshot each of these at 390px and 1280px, in light and dark:
  - the assign panel;
  - "From my coach" with every badge;
  - fork offers;
  - the assigned page with the "what changed" summary;
  - a fork with coach notes.

  Check them against `docs/design/`, fix tokens and spacing in the owning files, and report.

### Task C8: E2E journeys (qa)

**Files:**
- Create: `apps/web/e2e/assignments.spec.ts`. Extend the persona seeds if the coach persona lacks "Karo-Kan gynyba: pagrindai" and "Itališkoji partija".

- [ ] **C-M1-3:** The coach assigns "Karo-Kan gynyba: pagrindai" to "Šeštadienio grupė" with a deadline. All three members see it under "From my coach". A fourth account accepts the group invite later and sees it, with its deadline set by the R-16 rule.
- [ ] **C-M1-4:** "Itališkoji partija" is assigned to Rokas only, with Lithuanian comments. Rokas sees the comments as coach notes, and Gabija does not see the repertoire.
- [ ] **C-M1-6:** The coach removes Rokas from the group. The Karo-Kan leaves his list and a fork offer appears, while his individual Italian stays. The coach re-adds him: the Karo-Kan is back and the offer is gone.
- [ ] **A coach edit:** the coach adds a move to the Italian. Rokas sees "Atnaujinta" and the summary; after he opens it, the badge is gone.
- [ ] **Pause, then fork:** Rokas pauses the Italian, unpauses it, then makes his own copy. The copy shows the coach notes read-only, and the coach sees "forked".
- [ ] Each journey runs on a phone and on desktop, in LT and EN, following the S4 project config.

### Task C9: Security review (security-reviewer) - SECURITY

- [ ] Review the Part B and C diffs. Check:
  - every assignment, offer and fork query filters on the session account and an active link or ownership;
  - the composite foreign keys in B1;
  - `changeAssignments` cannot be skipped by any path that removes access (`unlink`, group changes, deletes);
  - the snapshot parsing;
  - forged-id handling in every action.

  Report findings to the lead.

### Task C10: Close the slice (lead, architect)

- [ ] Run `mp-code-review` on the slice diff and `improve-codebase-architecture` on the slice's files. The owner picks the follow-ups.
- [ ] Run `retro`.
- [ ] Close #255, #277 and #283 with the commit range and the CI result. Add R-numbers for any terms the owner approved in C6.

---

## Self-review against the spec

| Spec item | Task |
| --- | --- |
| `canAssign`, `effectiveDeadline`, `assignmentStatus`, `canPlayerTrain` (here `canUseAssignment`), `canFork`, `forkOfferState`, pause rules | A3, A4 |
| `graphChanges` (#277), `allLearned`, the reconciliation proof | A1, A2 (`reconcile` and its property tests already exist; A2 adds the C-M2-1 example) |
| Tables `assignments`, `assignment_players`, `repertoire_changes`, `fork_offers`, `fork_coach_notes` | B1 |
| assign, unassign, deadline, group inheritance, fork offers on unassign, unlink, leave and delete, offers closing on reassign | B2, B3 |
| `playerAssignments`, `changesSince`, `trainingRepertoires`, pause, seen | B4 |
| Fork, accept and decline an offer, R-49 auto-fork | B5 |
| `coachAssignments`, the delete count | B6 |
| The repertoire-view module (#283), the assign panel, home, the assigned page, fork notes | C1 to C4 |
| Testing: feature, E2E, reviews | C5 to C9 |
| Done means | C8 (journeys), A2 and B4 (reconciliation), B3 and B5 (offers and auto-fork), C5 and C9 (access) |

The spec named `canPlayerTrain`; the plan calls it `canUseAssignment`, because it guards opening, pausing and seen as well as training. `canFork` is the same rule under its own name.

## Spec gaps for the owner

These are not implemented; they are raised at the slice close.

1. **The data export (R-40, R-106)** does not list a player's assignments (coach, repertoire name, deadline) or open fork offers. Should it?
2. **A forked player's personal notes on the coach's repertoire** stay behind on it, dormant, after the fork copies them. Should they be deleted at fork time?
