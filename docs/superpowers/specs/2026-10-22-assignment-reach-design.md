# Assignment reach: design

Issue #288 (from the S5 architecture review, #255). Folds in #289. Related: #278 (the coach and owner side of the same pattern).
A deepening refactor with no product change: behaviour, rulings and every existing test's meaning stay as they are. Needs S5 (done). S6's `trainingRepertoires` builds on it, so it lands before or with S6.

## The rulings it must keep

| Ruling | What it means here |
| --- | --- |
| R-16 | An assignment reaches a player through their own row or a group they are in, current and future members. Leaving the group removes it unless it was also assigned individually. The group deadline moves to the join date if that is later |
| R-46 | A paused assignment stays assigned and leaves training |
| R-128 | A fork replaces the live assignment. The coach sees "forked". Assigning again makes it live again |
| R-129, R-132 | Done is never overdue. Paused can still be overdue |
| R-130, R-131 | Unassign and repertoire delete leave a 30-day fork offer. Players who also have it another way keep it |
| R-133, R-136 | "Updated" counts changes after the version last seen, and through a group only after joining |
| R-134 | An individual assignment's deadline (or its lack of one) wins over the group's |
| R-137 | A deleting coach's every live assignment gets its automatic fork, also one forked before and assigned again |
| R-138 | With Coach mode off, unassign and deadline changes are refused, and repertoire delete still unassigns |
| R-135 | The terms (no text changes here) |

ADR 0005 (live-linked assignments) and CLAUDE.md "rules live in domain objects" and "decided in the domain, enforced again in queries" are the rules this refactor serves.

## The problem, in the current code

The rule "an assignment reaches a player through their own row or a group they are in, and is live unless they forked it" is written six times in `packages/db/src/assignments`. Each copy differs a little in locking, coach filter and link join, and they use four names for it (effective, usable, live, hold):

1. **`effective.ts`**:
   - `rowsOf` (:58-69) reads the individual rows and the group rows for one player;
   - `effectiveAssignments` (:145-159) merges them per repertoire and filters out forked ones;
   - `liveRepertoireIds` (:162-168) gives the live ids. Only tests still call it.
2. **`access.ts`**:
   - `liveFor`/`liveRepertoire` (:28-63) is the same rule as an SQL filter;
   - `usable` (:66-70) calls `canUseAssignment({ assigned: true, ... })`, so the domain check is hollow. The caller already filtered, so `assigned` is a constant.
3. **`player-state.ts`**: `holdReach` (:41-68) is the same rule with `FOR KEY SHARE` for one player and repertoire, and `holdAssignment` (:80-93) adds the state row `FOR UPDATE`.
4. **`assign.ts`**:
   - `playersReached` (:54-72) gives the players a row reaches;
   - `clearForks` (:167-182) applies R-128 inside the change;
   - `unassignAll` (:300-331) reads the targets of a repertoire.
5. **`coach.ts`**:
   - `reachOf` (:119-144) is the same rule from the coach's side, with a link join;
   - `forkedPlayers` (:238-254) gives the players who forked;
   - `playerState`/`statesOf` (:147-192) calls `effectiveAssignments` once per reached player.
6. **`coach-delete.ts`**: `playersOfCoach` (:15-32) is the rule again, then `liveAssigneesOfCoach` (:38-48) calls `effectiveAssignments` per player.

It also runs per player:
- `changeAssignments` (`change.ts:155-175`) calls `effectiveAssignments` twice per player (`liveIdsOf`, :35-53). Then `settlePlayer` (:136-147) works per player: per lost pair it takes a snapshot and reads the coach's name, then it runs one `dropStaleState` (:115-128), which is another `effectiveAssignments`. That is about ten statements per player, all under the coach's lock.
- `coachAssignments` runs about three statements per reached player.

The status rule is written twice too:
- `player.ts` `statusOf` (:146-161);
- `coach.ts` `playerState` (:147-173).

What happens to a player when they lose or regain an assignment is a set difference coded in two places, `change.ts` `settlePlayer` and `assign.ts` `clearForks`. Only Testcontainers can test it (#289).

## Decisions

1. **One reach module, `packages/db/src/assignments/reach.ts`, folding all six copies.** It holds the only SQL that says how a row reaches a player:
   - a player row reaches `assignments.player_id`;
   - a group row reaches each `group_members.player_id` of `assignments.group_id`;
   - in both cases there must be a Coach link between `assignments.coach_id` and that player.

   The link condition is an `exists` subquery in `WHERE`, the `share-scope.ts:21` pattern. The foreign keys already guarantee it (`assignments_link_fk`, `assignment-schema.ts:56-60`; `group_members_link_fk`, `schema.ts:238-242`), so it changes no result. It is the query-level second line that `coach.ts` `reachOf` has today. A subquery in `WHERE` is never locked, so the held read locks exactly the rows `holdReach` locks today.
2. **One fact record per (player, repertoire).** `assignmentFacts(db, scope)` takes a batch and returns one `AssignmentFacts` per pair that at least one row reaches. A record holds:
   - the coach;
   - every reaching row (`reaches`: assignment id, deadline, assigned version, and join time, which is null for the player's own row);
   - the player's state (`pausedAt`, `seenVersion`, `forkedAt`).

   The scope is any combination of `playerIds`, `coachId` and `repertoireId`, with at least one of them. That covers:
   - one player (player reads);
   - a batch of players (changes);
   - a coach's repertoire (coach reads);
   - a whole coach (R-49).

   It runs three statements whatever the batch size: individual rows, group rows and states. A union cannot carry `FOR KEY SHARE`, so the two reach statements stay apart.
3. **The domain decides from the facts.** The record type `AssignmentFacts` lives in `packages/domain` (pure data). The domain gets these functions:
   - `canUseAssignment(facts | undefined)` and `canFork(facts | undefined)`: allowed only when the record exists, has at least one reach, and is not forked. This replaces `AssignmentHold`, so no caller can pass `assigned: true` any more;
   - `canKeepPersonalNotes(player, repertoire, facts | undefined)`;
   - `deadlineSources(reaches)`, moved from `effective.ts:107-117`, which uses `vilniusDay` as before. `effectiveDeadline` keeps its signature;
   - `assignmentStatusOf(facts, { done, now })`, which returns `{ deadline, overdue, paused, done, forked }`. It is the one status rule for the player's and the coach's reads. `done` stays an input, so S6 can supply learned moves.
4. **Lock strength is the module's, not the caller's.** `holdAssignment(tx, { playerId, repertoireId })` is the only locked entry point. It runs the same three statements with the same locks as today:
   - the reaching assignment rows `FOR KEY SHARE`;
   - for a group row, the membership row `FOR KEY SHARE`;
   - the state row `FOR UPDATE`, read by the (player, repertoire) key whether or not anything reaches the player.

   A batch is never locked: no caller needs that, and a batch lock would widen lock sets beyond what the race tests prove. #288 asked for a "lock strength" parameter. Here that parameter belongs to the module's internal statement builder, so no caller can choose a lock the race tests have not covered.
5. **The `live` SQL filter comes from the same module.** `liveRepertoire(db, playerId, repertoireId)` moves from `access.ts` into `reach.ts`, built from the same reach predicates. Its name stays, so the test at `assignment-player.test.ts:869` changes only its import path. The stale-state delete uses the same predicates (decision 7).
6. **#289 is folded in.** `settleAssignmentChange` is a pure domain function. It takes the before and after facts of a batch, the acting coach and, for an assign, the repertoire given, and returns a settlement plan of three lists: `unfork`, `offer` and `close`. Reasons for folding it in:
   - #288 has to rewrite `changeAssignments` around one batched before read and one batched after read anyway. The set difference in `settlePlayer` (`change.ts:136-147`) and `clearForks` (`assign.ts:167-182`) is the code that rewrite touches. Doing #289 separately would mean rewriting the same lines twice, the second time against a just-changed interface.
   - #289 says it pairs with this issue, because this issue supplies before and after in one batch.
   - It stays its own task (A2 in the plan), so the lead can split it off if a review asks. Both issues close together.
7. **`changeAssignments` stops looping per player.** It keeps its signature, so every caller keeps its call. Its new body has six steps:
   1. a batched before read, scoped to the coach;
   2. `apply`;
   3. a batched after read with the same scope;
   4. `settleAssignmentChange`;
   5. the plan's writes, each one statement over the batch:
      - unfork (`update` on the pairs);
      - offers (one multi-row `insert`);
      - closes (one `update`);
   6. one stale-state `delete`, for every player in the batch where `not exists` a reaching row.

   The snapshots move to `takeSnapshots(tx, pairs)`. It loads each distinct lost repertoire once, reads all the lost pairs' personal notes in one statement, and reads the coach's name once.
8. **R-128 moves into the plan.** `assign` no longer clears forks inside `apply`. It passes `given: repertoireId`. In the plan, a player who forked the given repertoire counts as live after the change: they are in `unfork`, and their open offer is in `close`. The result is the one `clearForks` gives today. `assign` holds the coach's account row, and `forkAssignment` takes that row first (`fork.ts:121-130`), so no fork can land between the after read and the unfork.
9. **What stays outside the module:**
   - `playersReached` (the players a target row reaches, `assign.ts:54-72`) moves into `reach.ts`. It is the same rule applied to a target before its row exists.
   - The `FOR UPDATE` reads of an assignment row by its id or repertoire (`assign.ts:230-249`, `:308-318`) stay in `assign.ts`. They lock the coach's own rows before a delete or update, which is ownership, not reach.
   - `groups.ts` `memberIds` (`deleteGroup`) stays. It is group membership.

## Design

### Domain (`packages/domain`)

- **`assignment.ts`:**
  - **`AssignmentReach`** extends `AssignmentStart` with `assignmentId` and `deadline`.
  - **`AssignmentFacts`** holds `playerId`, `repertoireId`, `coachId`, `reaches`, `pausedAt`, `seenVersion` and `forkedAt`.
  - **New functions:**
    - `deadlineSources(reaches)`;
    - `assignmentStatusOf(facts, { done, now })`.
  - **Changed functions:** `canUseAssignment` and `canFork` now take `AssignmentFacts | undefined`.
  - **Removed:** `AssignmentHold`.
  - **Unchanged:** `effectiveDeadline`, `assignmentStatus`, `isUpdated`, `newsOf` and `SeenFacts`. The db passes `{ seenVersion, starts: facts.reaches }`, because an `AssignmentReach` is an `AssignmentStart`.
- **`repertoire.ts`:** `canKeepPersonalNotes` takes `AssignmentFacts | undefined`.
- **`assignment-settlement.ts` (new, #289):** `settleAssignmentChange({ coachId, playerIds, before, after, given })` returns `{ unfork, offer, close }`:
  - **`offer`:** the pairs live before and not live after, among `coachId`'s repertoires. Ordered by first appearance in `playerIds`, then by repertoire id. That is today's insertion order (`effective.ts:151` sorts the ids), so the heap order of `fork_offers` stays the same.
  - **`close`:** the pairs live after and not live before.
  - **`unfork`:** the pairs after the change on the given repertoire that are forked.
  - **"Live"** means `canUseAssignment(facts).ok`. A pair on the given repertoire counts as unforked.
  - **Players named twice** count once.

### Database (`packages/db`)

- **`assignments/reach.ts` (new):**
  - `assignmentFacts(db, scope)`;
  - `holdAssignment(tx, key)`, which returns `AssignmentFacts | undefined`;
  - `liveRepertoire(db, playerId, repertoireId)`;
  - `playersReached(tx, targets)`;
  - `unreachedState(playerIds)`, the SQL condition for the stale-state delete.

  Its doc comment defines the code words: a row *reaches* a player, and an assignment is *live* for a player when it reaches them and they have not forked it. The domain names stay `canUseAssignment` and `canFork`.
- **Deleted:** `assignments/effective.ts`, `assignments/access.ts`. `player-state.ts` keeps only the pause and seen writes.
- **Callers moved onto `reach.ts`:**
  - `player.ts`:
    - `loadLive`, `openLive` and `changesSince` read `assignmentFacts` for the session player and keep `canUseAssignment`;
    - `statusOf` becomes `assignmentStatusOf`;
    - the query filter is still `liveRepertoire`.
  - `player-state.ts` `onOwnAssignment`, `fork.ts` `forkAssignment` and `personal-notes.ts` (`holdNotesAccess`, `setAssignedPersonalNote`) call `holdAssignment`, which returns facts. `NO_ASSIGNMENT` becomes `undefined`.
  - `coach.ts`:
    - `coachAssignments` reads `assignmentFacts({ coachId, repertoireId })` once, with display names in one statement, and lists each row's players through `reaches[].assignmentId`;
    - `assignedPlayerCount` counts the live records;
    - `reachOf`, `statesOf`, `playerState` and `forkedPlayers` go.
  - `coach-delete.ts`: `forkForDeletingCoach` reads `assignmentFacts({ coachId })` once and forks each live record, as R-137 requires. `playersOfCoach` and `liveAssigneesOfCoach` go.
  - `change.ts`: decision 7.
  - `assign.ts`:
    - `playersReached` moves to `reach.ts`;
    - `clearForks` goes;
    - `assign` passes `given`.
  - `snapshot.ts`: adds `takeSnapshots(tx, pairs)`. `takeSnapshot` stays for `fork.ts` and builds on it.
- **No schema change and no migration.**
- **No public export changes.** `packages/db/src/index.ts` keeps its names and types, and `apps/web` is untouched.

### Statement counts (the target)

| Path | Today | After |
| --- | --- | --- |
| `assignmentFacts` | `effectiveAssignments`: 3 per player | 3 for the whole batch (2 when nothing is reached) |
| `changeAssignments`, no repertoire lost | about 7 per player | 6 reads, `apply`, at most 2 plan writes and 1 delete, whatever the number of players |
| `changeAssignments`, repertoires lost | plus a snapshot, the coach's name and an insert per lost pair | plus one repertoire load per distinct lost repertoire, one notes read, one name read and one insert, whatever the number of players |
| `coachAssignments` | about 3 per reached player | repertoire load, rows, 3 facts and 1 names, whatever the number of players |
| `assignedPlayerCount` | 2 | 3 |
| `forkForDeletingCoach` | 2, then 3 per player | 3, then one fork per live pair. Each fork writes a repertoire, so that part stays |

These are proved by a test that counts statements (`pg.Client.prototype.query`). It compares the same operation on one player and on five players: the counts must be equal. There is no fixed number in the test, so the tests stay correct when `loadRepertoireRows` changes.

### Lock order (unchanged)

The S4 and S5 order: the coach's account row first, and never an account row after assignment rows. `reach.ts` never locks an account row. Every entry point keeps today's sequence:

| Entry point | Lock sequence |
| --- | --- |
| `assign` (`assign.ts:140-161`) | coach's account row, then the repertoire `FOR KEY SHARE`, then the link or group `FOR KEY SHARE`. Then unlocked facts reads, the insert, and the plan's writes (state rows, offers) |
| `unassign`, `setDeadline` (`assign.ts:255-267`) | coach's account row, then the assignment row `FOR UPDATE` |
| `unassignAll` | through `deleteRepertoire` (`repertoires/delete.ts:39`): the owner's account row, then the rows `FOR UPDATE` |
| `unlink` (`coaching.ts:199-200`), `leaveGroup` (`groups.ts:263-265`), the `groups.ts` coach paths through `mayChangeGroups`, and `acceptInvite` (`invites.ts:220-224`) | the coach's account row first |
| `forkAssignment` (`fork.ts:121-130`, :155-156) | coach's account row, then the repertoire `FOR SHARE`, then `holdAssignment` |
| pause, seen, personal notes | `holdAssignment` only, never an account row |
| `deleteAccount` (`account-delete.ts:61-63`) | the account row, then an unlocked facts read, then one fork per pair as above |

The race and lock tests that must keep passing unchanged:

- **`assignment-player.test.ts`:**
  - :555 waits for a group leave in progress and then finds nothing to pause;
  - :571 holds the membership it read, so a removal after it drops the player's state;
  - :966 waits for a group leave in progress and then refuses the note.
- **`forks.test.ts`:**
  - :233 waits for the coach row, so an unassign in progress leaves no fork beside its offer;
  - :251 makes an unassign wait for a fork in progress, which then offers nothing;
  - :270 waits for a coach edit in progress and copies the saved graph;
  - :508 runs again when a player's concurrent delete deadlocks with it (#286).
- **`coaching.test.ts`:**
  - :145 revokes an invite made while it waited for the coach row (R-109);
  - :404 waits for the coach row, so an assignment made meanwhile is offered too.
- **`groups.test.ts`:**
  - :230 refuses a group deleted while it waited for the group row;
  - :333 refuses to change a group once Coach mode went off while it waited for the coach row (each change);
  - :549 makes a leaving player wait for the coach row, so a group assignment made meanwhile is offered too.
- **`invites.test.ts`:** :424 refuses an invite whose coach is not the coach it locked.
- **`assignments.test.ts`:** :252 settles only the acting coach's repertoires, whatever another coach changes meanwhile.
- **`shares.test.ts`:** :304, :317, :397, :488 and :684 (the link-before-repertoire order that `deleteAccount` takes).

## Tests that change shape, not meaning

Four places test the code this refactor removes:
- **`assignments.test.ts:142-207`** (`effectiveAssignments`, `liveRepertoireIds`) is re-pointed to `assignmentFacts`. The six cases and what they check stay the same. The expected values are rewritten from `sources`/`starts` to `reaches`, and `deadlineSources(reaches)` must still equal the old `sources`.
- **The domain tables for `canUseAssignment`/`canFork` (`assignment.test.ts:320-330`) and `canKeepPersonalNotes` (`repertoire.test.ts:225-240`)** keep their four cases. The inputs are written as facts:
  - "not assigned" is `undefined`, or a record with `reaches: []`;
  - "forked" is a record with `forkedAt` set.
- **`assignment-player.test.ts:35`** changes its import path only.

Every other test stays as it is, byte for byte.

## Not in scope

- **#278's owner and coach scope.** `share-scope.ts` already has the coach-side predicate, and `reach.ts` is its player-side twin, with the same shape: one predicate plus one locked read. `personal-notes.ts` `notesAllowedFor` (:55-63) already composes `ownedBy` with `liveRepertoire`, and #278 can compose all three later.
- **Batch loading of graphs** in `player.ts` `loadLive` and `ownTraining`, which still call `loadRepertoireRows` once per repertoire. S6's `trainingRepertoires` (`player.ts:396-411`) is the next consumer of `assignmentFacts` for one player. If S6 needs batched graph loading, it adds it in the repertoire repository.
- **Any change to `CONTEXT.md`.** "Reach" and "live" stay code words, defined in `reach.ts`. If the lead wants them as domain terms, that is a later `domain-modeling` pass.

## Done means

- The rule is written once in SQL (`reach.ts`) and once in the domain:
  - `canUseAssignment`, `assignmentStatusOf` and `deadlineSources`;
  - `settleAssignmentChange`.
- No file outside `reach.ts` joins `assignments` to `group_members` for reach. A grep for `innerJoin(groupMembers` under `packages/db/src/assignments` finds only `reach.ts`.
- No caller passes `assigned: true`, and `AssignmentHold` is gone.
- The statement-count tests pass:
  - `changeAssignments` with no loss, with losses, and for an assign;
  - `coachAssignments`;
  - `forkForDeletingCoach` (its reads).
- Every existing test passes, the race tests above included. Only the tests listed under "Tests that change shape" change.
- Mutation testing in CI is green on the changed domain files.
- The gate is green.
- `security-reviewer` signs off: access and locking paths moved.
- #288 and #289 close.
