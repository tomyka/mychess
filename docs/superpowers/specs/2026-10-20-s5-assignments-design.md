# S5 Assignments: design

Issue #255 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S5, plus the fork offer on unlink moved here by R-96.
Brainstormed with the owner on 2026-10-20. Needs S3 (repertoires) and S4 (links, groups), both done.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-15, R-20, ADR 0005 | A coach assigns a repertoire, live-linked, with an optional deadline. The player may fork it |
| R-16 | A group assignment reaches current and future members. Leaving the group removes it unless it was also assigned individually. The effective group deadline is the later of the group deadline and the join date |
| R-21 | On a live assignment the player may add personal notes only. Changing moves needs a fork |
| R-23, R-121, R-53 | Reconciliation: unchanged moves keep their progress, new moves are to learn, removed moves leave review, and a changed move (added or removed) starts fresh. Reviews belong to player + position + move, so this follows from the keys |
| R-43, R-47 | A fork carries progress and is the player's private repertoire. It keeps the coach's notes read-only. The coach sees "forked", never the fork |
| R-44, R-45 | On unlink, or on leaving a group, the repertoire disappears, its Reviews go dormant, and a fork offer stays open for 30 days |
| R-46 | A player can pause an assignment. It leaves their reviews and learn queue, and the coach sees it as paused |
| R-49 | When a coach deletes their account, every player with an assignment from them gets an automatic fork with the coach's notes read-only |
| R-51 | A passed deadline marks the assignment overdue, and nothing is blocked. The coach can extend or clear the deadline. The notifications are M2 |
| R-52 | M1 shows a "coach updated" flag only. The batched notification is M2 |
| R-128 | A fork replaces the live assignment: the coach sees "forked", and edits no longer reach that player |
| R-129 | An assignment is done when every own-side move has been learned (finished the learn pass, or marked "I know this"). A done assignment is never overdue. A coach edit that adds moves makes it not done again |
| R-130 | Unassigning works like unlink (R-44): the repertoire disappears, its Reviews go dormant, and a fork offer stays open for 30 days. Members who also have it individually keep it |
| R-131 | A coach may delete an assigned repertoire. That unassigns it from everyone first (R-130), and the confirm dialog says how many players have it |
| R-132 | A paused assignment whose deadline passes is still overdue |
| R-133 | "Updated" shows on an assigned repertoire until the player opens it. Opening it shows what changed since their last visit: moves added and removed, by chapter |
| R-134 | When a player has a repertoire both individually and through a group, the individual assignment's deadline (or its lack of one) applies |

## Lead decisions

1. **Assignments are stored per target and derived per player** (approach A of the brainstorm). An `assignments` row targets one player or one group. A player's assignments are a query: their individual ones plus those of every group they are in. Inheriting on join and losing on leave follow from the data, with nothing to keep in sync.
2. **A deadline is a calendar date.** It is overdue from the start of the next day in Europe/Vilnius. A player who joins a group after its deadline gets their join date as the deadline (R-16, applied literally).
3. **A fork offer is a snapshot taken when the assignment ends** for that player: the graph, the coach's comments and the coach's display name. Later coach edits, a repertoire delete or the coach's account delete never change what the player can still keep.
4. **An open fork offer closes when the same repertoire is assigned to the player again**, for example when they are re-added to the group (C-M1-6). Their dormant Reviews come back with the moves.
5. **A coach assigns only their own repertoires**, never a repertoire a player shared with them. They assign only to linked players or to their own groups. A repertoire can be assigned to a target at most once.
6. **The coach's comments in a fork are kept apart** from the player's own comments, in `fork_coach_notes`, read-only and marked with the coach's name. The chess graph model stays unchanged.
7. **One repertoire view module (#283)** serves the owner, the sharing coach and the assigned player. S5 builds the assigned view on it instead of adding a third page.
8. **The graph diff moves into `packages/chess` as `graphChanges` (#277).** The S3 save and the "what changed" summary both use it.
9. **No per-player reconciliation job.** Training reads the current graph of each repertoire the player trains. Kept move keys keep their Review, new keys have none (to learn), and removed keys are no longer held (dormant). S5 provides `trainingRepertoires(player)` as S6's seam and proves the rule at the chess level.

## Design

### Domain (`packages/domain`)

- **`canAssign(coach, repertoire, target, facts)`** refuses with a value when:
  - the repertoire is not the coach's own;
  - the account is not a coach (Coach mode off);
  - the player is not linked, or the group is not the coach's;
  - the repertoire is already assigned to that target.
- **`effectiveDeadline(individual, groupAssignments)`.** An individual assignment wins (R-134). Otherwise, across the player's groups, each group deadline is first moved to the later of itself and the join date, and the earliest of those applies. No deadline anywhere means no deadline.
- **`assignmentStatus({ deadline, done, paused, forked }, now)`** returns the badges the player and the coach see: `overdue` (deadline passed and not done, paused included per R-132), `paused`, `done` and `forked`.
- **`canPlayerTrain(player, repertoireId, facts)`.** A player reads a coach's repertoire only while it is effectively assigned to them and not forked by them. This is the player-side twin of `canCoachSee`.
- **`canFork`** is for a live assignment of the player's only. **`forkOfferState(offer, now)`** gives `open`, `expired`, `accepted`, `declined` or `closed` (assigned again). `FORK_OFFER_TTL` is 30 days.
- **`canPause` and `canUnpause`** are for the player's own effective assignment only.

### Chess (`packages/chess`)

- **`graphChanges(before, after)`** gives the added and removed player-move keys by chapter, plus the comment and mark changes the S3 save already needs (#277).
- **`allLearned(graph, learnedKeys)`** reports whether every own-side move of the graph is in the learned set (R-129). Until S6 writes Reviews the set is empty.
- **A property test of reconciliation:** across `heldKeys` and `scopeKeys`, for any edit, kept keys stay held, added keys are new, and removed keys stop being held.

### Database (`packages/db`)

- **`assignments`**: id, coach, repertoire, `player_id` or `group_id` (exactly one, CHECK), deadline (date, nullable), created.
  - A composite foreign key to `repertoires (id, owner)` makes it the coach's own repertoire.
  - A composite foreign key to `coach_links` covers a player target, and one to `groups (id, coach)` covers a group target.
  - Each pair of repertoire and target is unique.
  - An unlink cascade removes individual rows. A group delete removes group rows.
- **`assignment_players`**: player, repertoire, `paused_at`, `seen_version`, `forked_at`. It is created on the player's first access or pause. `forked_at` is what makes the coach see "forked" (R-128).
- **`repertoire_changes`**: repertoire, version, the added and removed move keys with their chapters, created. One row is written per graph edit, in the S3 save transaction.
- **`fork_offers`**: id, player, the coach's display name, the source repertoire (nullable: set to null when the repertoire is deleted), the repertoire name and side, the snapshot (graph JSON and coach comments), the reason (`unassigned`, `unlinked`, `left_group`, `deleted`), created, expires, accepted or declined or closed.
- **`fork_coach_notes`**: fork repertoire, move key, text, the coach's display name.
- **Repositories, all transactional:**
  - `assign` and `unassign` (an unassign writes a fork offer for each player who loses the repertoire), `setDeadline` and `clearDeadline`;
  - `pauseAssignment` and `unpauseAssignment`, and `markSeen` (on open);
  - `playerAssignments(player)`: each effective assignment with its coach, deadline, status inputs, and an "updated" flag (the version is greater than `seen_version`);
  - `changesSince(repertoire, version)` for the summary;
  - `trainingRepertoires(player)`: their own repertoires plus their live assigned ones, with `active = not paused`;
  - `fork(player, repertoire)`: copies the graph and chapters through the S3 write into a new repertoire the player owns, writes `fork_coach_notes`, sets `forked_at`, and writes no Review rows;
  - `acceptForkOffer` (the same copy, from the snapshot) and `declineForkOffer`;
  - `coachAssignments(coach, repertoire)`, listing each target with its per-player state.
- **The existing transactions gain fork offers:**
  - unlink, `leaveGroup` and removing a member write fork offers for the assignments the player loses;
  - deleting a repertoire unassigns it first (R-131);
  - S1's account delete auto-forks for every player of a deleting coach (R-49) before the cascade.

### Web (`apps/web`)

- **The coach's repertoire page (`/repertuarai/[id]`)** gets an "Assign" panel:
  - pick linked players and groups, with an optional deadline;
  - a list of the current assignments with their per-player badges (paused, overdue, forked);
  - extend or clear a deadline, and unassign (with a confirm dialog);
  - the delete dialog counts the players who have the repertoire.
- **Player home (`/pradzia`):**
  - "From my coach" lists each assigned repertoire with the coach's name, the deadline, and the overdue, paused and "Updated" badges;
  - open fork offers, each with "Keep a copy" and "No, thanks" and the days left.
- **The assigned repertoire view** (on the #283 module) is read-only:
  - the board with the coach's comments as coach notes and the player's personal notes (R-21);
  - pause and unpause;
  - "Make my copy" (fork, with a confirm saying coach edits stop reaching it);
  - the "what changed" summary while "Updated" is shown, which is then marked seen.
- **A forked repertoire** shows the coach's notes read-only with the coach's name.
- **Server actions** take the coach or player from the session only, call the domain rule, and save. A client-sent `playerId`, `coachId` or `groupId` is checked through the domain, never trusted.

## Testing

- **Domain:** tables of cases for `canAssign`, `effectiveDeadline` (individual wins, join date later than the deadline, several groups), `assignmentStatus` (each badge, R-132 paused and overdue, done never overdue), `canPlayerTrain` and `forkOfferState`. All are mutation-tested.
- **Chess:** `graphChanges` examples plus the reconciliation property test. `allLearned`.
- **Database:**
  - a group assignment reaches a member added later, and leaving removes it unless they also have it individually;
  - unassign, unlink, leave and delete each write exactly one fork offer per affected player;
  - re-assigning closes an open offer;
  - a fork copies the moves and notes and leaves the source untouched;
  - the coach's account delete auto-forks, and the fork survives the cascade;
  - an edit writes a `repertoire_changes` row.
- **Feature tests (the S4 checklist pattern):**
  - a coach cannot assign another account's repertoire, or assign to an unlinked player or another coach's group;
  - a player cannot read an assignment that is not theirs, or one after unassign or unlink;
  - forged ids are ignored.
- **E2E (Playwright):**
  - C-M1-3: assign "Karo-Kan gynyba: pagrindai" to "Šeštadienio grupė"; three members get it, and a fourth who joins later gets it with the deadline rule;
  - C-M1-4: an individual assignment with Lithuanian notes reaches Rokas only;
  - C-M1-6: remove Rokas from the group, and he gets a fork offer while keeping the individual assignment; re-add him, and it is back with the offer closed;
  - a coach edit shows "Updated" with the summary;
  - pause, then fork.
  - Each journey runs on a phone and on desktop, in LT and EN.
- **Reviews:** security-reviewer on the access rules and the forged-id tests; ux-designer and i18n-content on the new screens and terms.

## Done means

- The coach persona's journeys C-M1-3, C-M1-4 and C-M1-6 pass.
- A coach edit reaches every player who has the repertoire, flags it "Updated" with the right summary, and keeps unchanged moves' keys held, so their progress is kept (reconciliation property test).
- Unassign, unlink, leaving a group and deleting a repertoire each leave the player a working 30-day fork offer. A coach's account delete leaves an automatic fork.
- No account reads or assigns what it may not (tests). Security-reviewer signs off. The gate and CI are green.
