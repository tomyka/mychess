# Edit a Repertoire in One Place: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deep `editRepertoire(db, { id, viewer, expectedVersion, change, now })` in `packages/db` that locks the repertoire row once, asks the domain (may this viewer edit it from this version?) and chess (what is the new graph?) to decide, writes the minimal diff, records what changed for players (R-121, R-133) and returns `{ version, graph, changes, firstChapterId }`. The builder action and the import confirm only authenticate, parse and call it. Behaviour, rulings and lock strength stay unchanged.

**Architecture:**
- **Chess** (`packages/chess/src/repertoire/apply-change.ts`, new): `RepertoireChange` (`edit` with an `EditOp`, or `import` with an `ImportedRepertoire`) and `applyChange`, which delegates to `applyEdit` and `mergeInto` and turns R-115 into a refusal.
- **Domain** (`packages/domain/src/repertoire.ts`): `canEditRepertoireAt(viewer, repertoire, expectedVersion)`, the owner check then the stale check.
- **Database** (`packages/db/src/repertoires/edit.ts`, new): `editRepertoire`, on a package-internal `holdRepertoire` (`FOR NO KEY UPDATE`, the strength today's version `UPDATE` takes) and the existing `graphRows`, `writeChanges`, `recordChanges`. `saveRepertoireEdit` and `RepertoireEdit` are removed.
- **Web:** `editRepertoireAction` and `import-preview.ts` `importInto` call `editRepertoire`. The preview, rename and delete are untouched.

**Tech Stack:** Drizzle 0.45.3 on Postgres 18, pg 8.23.0, zod 4, vitest 4 (Testcontainers for db), Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-10-22-repertoire-edit-design.md` (the lead files it under that name). **Issue:** #276. **Rulings kept:** R-121, R-23, R-53, R-133, R-136, R-39, R-42, R-54, R-63, R-104, R-101, R-111, R-115, R-117, R-122, R-66, R-119; S3 decisions 6, 10 and 12. **ADR:** 0003, 0005.

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

**Commits:** the lead commits at three checkpoints:
- after A2: `refactor(chess, domain): applyChange and canEditRepertoireAt decide a repertoire edit (#276)`;
- after B2: `refactor(db): editRepertoire locks once, decides through chess and domain, returns the changes (#276)`;
- after C3: `refactor(web): the builder and the import confirm call editRepertoire; saveRepertoireEdit gone (#276)`.

A1, A2 and B1-B2 only add; the removal of `saveRepertoireEdit` lands in C3 with the last caller gone, so every checkpoint typechecks. If knip flags a new export as unused at a checkpoint (`applyChange`, `canEditRepertoireAt`, `editRepertoire` before web uses them), the lead holds the commit until the next checkpoint instead of suppressing.

---

## Verified library API

Checked against the installed packages and the code while planning (2026-10-22). A worker who finds a difference stops and tells the lead.

- **drizzle-orm 0.45.3:**
  - `select(...).for('no key update')` exists (`LockStrength`, `pg-core/query-builders/select.types.d.ts:60-72`) and is already used at `packages/db/src/accounts.ts:45`.
  - A transaction begins with one statement, `begin` with the isolation level inline (`node-postgres/session.js:184`), so a default transaction is BEGIN + statements + COMMIT.
  - Every statement goes through `client.query(queryConfig, params)` with `queryConfig.text` (`node-postgres/session.js:113,124,143`); the transaction's `begin`/`commit` go through `execute(sql\`begin\`)`, the same path.
- **pg 8.23.0:** `vi.spyOn(pg.Client.prototype, 'query')` sees every statement (`packages/db/test/support/statements.ts`, proved in #288).
- **Postgres 18:** an `UPDATE` that changes no key column takes `FOR NO KEY UPDATE` on the row. It conflicts with `FOR SHARE` (fork, `fork.ts:106-113`), `FOR NO KEY UPDATE` and `FOR UPDATE` (a delete), and not with `FOR KEY SHARE` (assign, `assign.ts:66`; personal notes, `personal-notes.ts:84`). `holdRepertoire` takes the same strength, so the lock set does not change.
- **The code this plan builds on:**
  - `apps/web/src/app/repertuarai/[id]/actions.ts:146-213` (`EditOutcome`, `EDIT_ISSUES`, `EditRefusalKey`, `editRepertoireAction`);
  - `apps/web/src/server/import-preview.ts:244-307` (`mergeIntoOwn`, `importInto`), `:68-81` (`ImportRefusalKey`);
  - `apps/web/src/server/repertoires.ts:46-58` (`ownRepertoire`);
  - `packages/db/src/repertoires/repository.ts:98-165` (`graphRows`, `loadRepertoireRows`), `:213-264` (`RepertoireEdit`, `saveRepertoireEdit`);
  - `packages/db/src/repertoires/scope.ts:43-58` (`repertoireScope`);
  - `packages/db/src/repertoires/write.ts:251-274` (`writeChanges`);
  - `packages/db/src/assignments/move-changes.ts:24-35` (`recordChanges`);
  - `packages/chess/src/repertoire/edit.ts:18-26, 205-260` (`EditRefusal`, `EditOp`, `applyEdit`), `merge.ts:29-56, 227-240` (`MergedRepertoire`, `NothingToAdd`, `MergeRefusal`, `mergeInto`), `changes.ts:107-156`;
  - `packages/domain/src/repertoire.ts:72-190` (`REPERTOIRE_REFUSALS`, `RepertoireAccessRefusal`, `canEditRepertoire`, `canUseScope`).

---

## Decisions taken while planning

None of these is a product rule.

1. **The chess types** (spec, Design / Chess). The conditional `ChangeRefusal<C>` narrows by kind so that:
   - `editRepertoire(..., { kind: 'edit', op })` refuses with `RepertoireAccessRefusal | RepertoireStaleRefusal | EditRefusal`, today's `EditRefusalKey` set minus the web-only parse keys;
   - `editRepertoire(..., { kind: 'import', imported })` refuses with `... | MergeRefusal | NothingToAdd`, inside today's `ImportRefusalKey`.

   `applyChange` is implemented as two small functions, `applyEditChange` and `applyImportChange`, and a `switch` on `change.kind`. Inside the generic body the narrowed result is returned with a cast-free helper per kind; if TypeScript cannot relate the conditional type without a cast, use two overload signatures over one implementation signature returning `Result<AppliedChange, ChangeRefusal>`. No `as` on a `Result`, no `any`.
2. **`applyImportChange`:** `mergeInto(graph, imported)`; a `MergeRefusal` is returned as is; `merged.added` refused (`pgn.nothingToAdd`) is returned as the refusal; otherwise `{ graph: merged.graph, firstChapterId: merged.added.value.firstChapterId }`. `merged.skipped` is dropped: the confirm never showed it (the preview does).
3. **`canEditRepertoireAt`:**

```ts
export interface RepertoireStaleRefusal {
  readonly reason: typeof REPERTOIRE_REFUSALS.stale;
}

/** May `viewer` save an edit computed from `expectedVersion`? Owner first (decision 12), then the version (S3 decision 6). */
export function canEditRepertoireAt(
  viewer: Pick<Account, 'id'>,
  repertoire: Pick<Repertoire, 'ownerId' | 'version'>,
  expectedVersion: number,
): Result<undefined, RepertoireAccessRefusal | RepertoireStaleRefusal> {
  const allowed = canEditRepertoire(viewer, repertoire);
  if (!allowed.ok) return allowed;
  return repertoire.version === expectedVersion
    ? ok()
    : refuse(REPERTOIRE_REFUSALS.stale);
}
```

4. **`editRepertoire` body** (`packages/db/src/repertoires/edit.ts`), one `db.transaction`, split so each function stays under complexity 10:

```ts
return db.transaction(async (tx) => {
  const held = await holdRepertoire(
    tx,
    repertoireScope(tx, ownScope(request.viewer.id), 'edit', request.id),
  );
  if (held === undefined) return refuse(REPERTOIRE_REFUSALS.notFound);
  const allowed = canEditRepertoireAt(request.viewer, held, request.expectedVersion);
  if (!allowed.ok) return allowed;
  const before = await graphRows(tx, held.id, held.side);
  const applied = applyChange(before, request.change);
  if (!applied.ok) return applied;
  return ok(await save(tx, held.id, before, applied.value, request.now));
});
```

   `save` bumps the version (`update repertoires set version = version + 1, updated_at = $now where id = $id returning version`, parsed with zod; no row is a programmer error and throws, since the row is held), calls `writeChanges(tx, id, graphChanges(before, after.graph))`, computes `changes = playerMoveChanges(before, after.graph)`, calls `recordChanges(tx, { repertoireId, version, changes, now })`, and returns `{ version, graph: after.graph, changes, firstChapterId: after.firstChapterId }`. Statement order inside the transaction is today's: version, diff, record.
5. **`holdRepertoire(tx, where)`** in `repository.ts` is the meta select of `loadRepertoireRows` (`metaColumns`, `limit 1`) with `.for('no key update')`, parsed with `repertoireSchema`. `loadRepertoireRows` keeps its signature (the assignment and snapshot code calls it). `graphRows` gets `export` for `edit.ts`; neither is exported from `src/index.ts`.
6. **The statement-shape helper.** `test/support/statements.ts` gains `statementsOf(run): Promise<string[]>`: the same spy as `countStatements`, returning each call's SQL text (`typeof arg === 'string' ? arg : arg.text`). Tests match texts by `/^begin/i` and `/from "move_chapters"/`, never by a total count.
7. **The web refusal types stay as they are.** `EditRefusalKey` (`actions.ts:163-168`) and `ImportRefusalKey` (`import-preview.ts:68-79`) are not edited; `editRepertoire`'s narrowed refusal must be assignable to them. If it is not, the worker stops and reports: the conditional type is wrong, not the web union.

---

## File structure

**packages/chess** (chess-dev):
- `src/repertoire/apply-change.ts`, `src/repertoire/apply-change.test.ts` (new, A1).
- `src/index.ts`: exports `applyChange`, `RepertoireChange`, `ChangeRefusal`, `AppliedChange` (A1).

**packages/domain** (backend-dev):
- `src/repertoire.ts`, `src/repertoire.test.ts`: `RepertoireStaleRefusal`, `canEditRepertoireAt` (A2).
- `src/index.ts`: exports (A2).

**packages/db** (backend-dev):
- `src/repertoires/edit.ts` (new, B1).
- `src/repertoires/repository.ts`: `holdRepertoire`, `graphRows` exported in-package (B1); `saveRepertoireEdit`, `RepertoireEdit`, `versionRowsSchema` removed (C3).
- `src/index.ts`: `editRepertoire` and its types (B1); `saveRepertoireEdit`, `RepertoireEdit` dropped (C3).
- `test/repertoire-edit.test.ts` (new, B1). It matches the db vitest `include` (`test/**/*.test.ts`), so the gate runs it.
- `test/support/statements.ts`: `statementsOf` (B1).
- `test/repertoires.test.ts`, `test/assignment-player.test.ts`, `test/forks.test.ts`, `test/personal-notes.test.ts`: re-pointed (B2).

**apps/web** (web-dev):
- `src/app/repertuarai/[id]/actions.ts` (C1).
- `src/server/import-preview.ts` (C2).

---

## Part A: rules (chess, domain)

### Task A1: Deciding a change in chess (chess-dev)

**Files:**
- Create: `packages/chess/src/repertoire/apply-change.ts`, `apply-change.test.ts`
- Modify: `packages/chess/src/index.ts`

- [ ] **Step 1: Write the tests.** Use the fixtures `edit.test.ts` and `merge.test.ts` already use (London-type graphs, the merge PGNs).
  - **`edit` changes:** for each op kind (`addMove` with a chapter, `addMove` with `chapterId: null` on an empty graph (R-111), `removeMove`, `setMarks`, `editComment`, `addChapter`, `renameChapter`, `removeChapter`), `applyChange(g, { kind: 'edit', op })` is `{ ok: true, value: { graph: <applyEdit(g, op).value>, firstChapterId: null } }`.
  - **`edit` refusals:** one case per `EditRefusal` reason (`unknownChapter`, `illegalMove`, `unknownPosition`, `secondAnswer`, `unknownMove`) gives exactly `{ ok: false, refusal: { reason } }`.
  - **`import` changes:**
    - a file adding two games gives `mergeInto`'s graph and `firstChapterId` equal to `added.value.firstChapterId` (assert the literal id, for example `'c2'`);
    - the other side gives `{ ok: false, refusal: { reason: 'repertoire.sideMismatch' } }`;
    - every game refused against the repertoire (R-115) gives `{ ok: false, refusal: { reason: 'pgn.nothingToAdd' } }`;
    - every game already there (R-117, R-122) gives the same refusal.
  - **Purity:** the input graph is deep-equal to a copy taken before the call, for one edit and one import.
  - No property test (spec, Testing).

- [ ] **Step 2:** Run `pnpm --filter @mychess/chess test -- apply-change`. It should fail because the module is missing.

- [ ] **Step 3: Implement** (decisions 1-2). Export from `src/index.ts`.

- [ ] **Step 4:** Run the chess tests and the chess typecheck and check they pass. Report, with the shape of the conditional type you ended up with.

### Task A2: The edit rule in the domain (backend-dev) - SECURITY

**Files:**
- Modify: `packages/domain/src/repertoire.ts`, `src/repertoire.test.ts`, `src/index.ts`

- [ ] **Step 1: Write the tests.** A table for `canEditRepertoireAt`, repertoire `{ ownerId: 'rokas', version: 3 }`:
  - `rokas` at 3: `{ ok: true }`;
  - `rokas` at 2 and at 4: `{ ok: false, refusal: { reason: 'repertoire.stale' } }`;
  - `rimantas` at 3: `{ ok: false, refusal: { reason: 'repertoire.notFound' } }`;
  - `rimantas` at 2: not found (access is decided first, so a stranger never learns the version).

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- repertoire`. It should fail.

- [ ] **Step 3: Implement** (decision 3). Export `canEditRepertoireAt` and `RepertoireStaleRefusal` from `src/index.ts`.

- [ ] **Step 4:** Run the domain tests and check they pass. Report. The lead commits A1 and A2 (or holds for knip).

---

## Part B: database

### Task B1: `editRepertoire` (backend-dev) - SECURITY

**Files:**
- Create: `packages/db/src/repertoires/edit.ts`, `packages/db/test/repertoire-edit.test.ts`
- Modify: `packages/db/src/repertoires/repository.ts`, `packages/db/src/index.ts`, `packages/db/test/support/statements.ts`

- [ ] **Step 1: Spike the text capture.** Add `statementsOf` (decision 6). First test in `repertoire-edit.test.ts`: `statementsOf(() => db.transaction((tx) => tx.select().from(accounts)))` has three texts, the first matching `/^begin/i` and the last `/^commit/i`. If not, stop and tell the lead.

- [ ] **Step 2: Write the behaviour tests.** Seed as `repertoires.test.ts` does (`seedAccount`, `createRepertoire` of `LONDON`, `T0`, `T1`, `rowVersions`, `canonical`). An `edit(id, viewer, version, change)` helper calls `editRepertoire(db, { id, viewer: { id: viewer }, expectedVersion: version, change, now: T1 })`.
  - **A comment edit** (`editComment` on 1. d4) returns `ok` with `version: 2`, the saved graph equal to `loadRepertoire`'s, `firstChapterId: null`, and `changes: { added: [], removed: [], commentsChanged: 1 }`; only the row `move <d4 key>` changed its `xmin` (as `repertoires.test.ts:93`).
  - **Moves and links:** `removeMove` Bf4 from c1 at version 1, then `addMove` c4 at version 2; the stored graph equals the chess result of the same two ops.
  - **R-111:** `addMove` with `chapterId: null` on an empty repertoire stores chapter one with 1. e4 in one edit, `version: 2`.
  - **Import:** `{ kind: 'import', imported: importPgn(<two new Black games>, 'black').value }` into a Black repertoire adds the chapters after the existing ones and returns `firstChapterId: 'c2'`.
  - **Changes equal the record:** for an edit adding a player move, the returned `changes` deep-equal `playerMoveChanges(before, after)` and the `changes` column of the one `repertoire_changes` row at the returned version.
  - **A chapter rename** returns changes for which `nothingChanged` is true and writes no `repertoire_changes` row; the version still bumps (spec decision 8).
  - **A no-op edit** (`addMove` of a move the chapter has) bumps the version and writes no `repertoire_changes` row (today's behaviour).

- [ ] **Step 3: Write the refusal tests.** Each asserts the exact refusal and that the version, the canonical graph and the `repertoire_changes` rows are unchanged:
  - stale (`expectedVersion` 1 after one edit): `repertoire.stale`;
  - another account (`rimantas`), at the right version: `repertoire.notFound`;
  - a missing id (a fresh uuid): `repertoire.notFound`;
  - an illegal move: `repertoire.illegalMove`;
  - an import of the other side: `repertoire.sideMismatch`;
  - an import that adds nothing: `pgn.nothingToAdd`;
  - **decides against the stored graph:** load the graph at version 1, remove 1. d4 from both chapters (two edits), then send `editComment` on 1. d4 at version 3: `repertoire.unknownMove`.

- [ ] **Step 4: Write the race tests** (`openTransaction`, `someoneWaitsForALock` from `test/support/coaching.ts`):
  - **Edit against edit:** open `update repertoires set version = version + 1 where id = '<id>'`; start an `editComment` at version 1; `someoneWaitsForALock`; `finish()`; the edit returns `repertoire.stale`, and the stored comment is unchanged.
  - **Edit against delete:** open `delete from repertoires where id = '<id>'`; start an edit at version 1; wait; `finish()`; the edit returns `repertoire.notFound`, and no `repertoire_changes` row exists.
  - **Edit against a fork's read:** open `select 1 from repertoires where id = '<id>' for share`; start an edit; `someoneWaitsForALock` resolves; `finish()`; the edit returns `ok` with `version: 2`.
  - **Edit beside a key-share hold:** open `select 1 from repertoires where id = '<id>' for key share`; the edit returns `ok` while the transaction is still open (await it before `finish()`). This proves the lock is not `FOR UPDATE`.

- [ ] **Step 5: Write the statement-shape tests** with `statementsOf`:
  - a comment edit sends exactly one `begin` and exactly one statement matching `/from "move_chapters"/`;
  - a stale edit and a not-found edit send one `begin` and no statement matching `/from "repertoire_moves"/`.

- [ ] **Step 6:** Run `pnpm --filter @mychess/db test -- repertoire-edit`. It should fail because `editRepertoire` is missing.

- [ ] **Step 7: Implement** (decisions 4-5): `holdRepertoire` and the `graphRows` export in `repository.ts`; `edit.ts` with `editRepertoire`, `save`, and the types of the spec; the exports in `src/index.ts`. Leave `saveRepertoireEdit` in place until C3.

- [ ] **Step 8:** Run the db tests (all of them: the lock tests of #288 must stay green) and check they pass. Report the statement counts you observe for the comment edit and the stale edit (expected 9 and 3; the tests do not pin them).

### Task B2: Existing db tests onto `editRepertoire` (backend-dev)

Only the tests the spec lists under "Tests that change shape". Assertions stay unless the spec says otherwise.

**Files:**
- Modify: `packages/db/test/repertoires.test.ts`, `test/assignment-player.test.ts`, `test/forks.test.ts`, `test/personal-notes.test.ts`

- [ ] **Step 1: `repertoires.test.ts`.** Delete the `saveRepertoireEdit` block (:92-237) and the R-133 block (:239-307) after checking that B1's tests cover each case as the spec maps it:
  - :93 -> the comment-edit test; :117 -> moves and links; :138 -> R-111; :162 -> "decides against the stored graph"; :185 -> stale; "another account" -> not found;
  - R-133 :267 -> move into `repertoire-edit.test.ts` with ops: `addMove` Bd6 (opponent, records nothing) then `addMove` Bd3; expect one row, at version 3, with `changes` equal to `playerMoveChanges(<graph at v2>, <graph at v3>)` and `added` of length 1;
  - R-133 :286 (rename writes nothing) and :293 (comment as one changed move) -> move with one op each, same assertions.

  Keep the create/load and list/rename/delete blocks byte for byte; drop the now-unused imports only.
- [ ] **Step 2: `assignment-player.test.ts`.** `coachEdit` (:93-110) becomes `coachEdit(op: (graph: RepertoireGraph) => EditOp, now = LATER)`: it loads `coachCopy()`, builds the op from the stored graph, and calls `editRepertoire(db, { id: rep, viewer: { id: 'c' }, expectedVersion: repertoire.version, change: { kind: 'edit', op: op(graph) }, now })`, expecting `ok`. `addE3`, `removeE3`, `removeBf4`, `addC4`, `commentD4` become op builders with the same targets. :678 becomes `await coachEdit(addC4); await coachEdit(commentD4);`. No assertion changes.
- [ ] **Step 3: `forks.test.ts:299`.** The coach's later edit is `editRepertoire` with an `addMove` op of e3 after 2... Nf6 at the loaded version; same `toMatchObject({ ok: true })`.
- [ ] **Step 4: `personal-notes.test.ts:139`.** Two `removeMove` edits of 1. d4 (c1 at version 1, c2 at version 2); same assertions.
- [ ] **Step 5:** Run the db tests and check they pass. `git diff --stat packages/db/test` lists only these four files plus B1's. Report. The lead commits B1 and B2.

---

## Part C: web, and the old writer gone

### Task C1: The builder action calls `editRepertoire` (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/app/repertuarai/[id]/actions.ts`

- [ ] **Step 1: Tests.** No new test: `apps/web/test/feature/repertoire-edit.test.ts` is the contract and must pass unchanged. Run it first, green, to have the baseline.

- [ ] **Step 2: Implement.** `editRepertoireAction` becomes:
  1. `requireOnboarded()`;
  2. `editRequestSchema.safeParse(input)`, refused with `editIssue` as today;
  3. `editRepertoire(getDb(), { id: repertoireId, viewer: account, expectedVersion: version, change: { kind: 'edit', op }, now: new Date() })`;
  4. a refusal is `refused(edited.refusal.reason)`;
  5. success is `{ ok: true, graph, version, ecoNames: ecoNamesOf(graph, account.locale) }`.

  Remove the `applyEdit` and `saveRepertoireEdit` imports. `ownRepertoire` stays: rename and delete still use it. Update the action's doc comment and the file header: the edit decides in `editRepertoire`, which checks the owner again in its query.

- [ ] **Step 3:** Run `apps/web/test/feature/repertoire-edit.test.ts`, `repertoire-page.test.ts`, `repertoire-note-race.test.ts` and `src/app/repertuarai/[id]` unit tests. All pass unchanged. Report.

### Task C2: The import confirm calls `editRepertoire` (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/server/import-preview.ts`

- [ ] **Step 1: Tests.** No new test: `apps/web/test/feature/repertoire-import.test.ts` is the contract (confirm into an existing repertoire :336, R-115 :358, stale :372, foreign and other side :393, the R-119 block :431-495). Run it first, green.

- [ ] **Step 2: Implement.** `importInto(account, target, imported, now)` calls `editRepertoire(getDb(), { id: target.id, viewer: account, expectedVersion: target.version, change: { kind: 'import', imported }, now })`. A refusal is `refused(edited.refusal)`; success is `{ ok: true, id: target.id, chapterId: edited.value.firstChapterId }`. `mergeIntoOwn` stays for `previewImport` only; adjust its doc comment. The module header says the confirm decides in `editRepertoire` under the row lock (stale first, spec decision 3).

- [ ] **Step 3:** Run `repertoire-import.test.ts` and the `importuoti` unit tests. All pass unchanged. Report.

### Task C3: `saveRepertoireEdit` removed (backend-dev)

**Files:**
- Modify: `packages/db/src/repertoires/repository.ts`, `packages/db/src/index.ts`

- [ ] **Step 1:** Delete `saveRepertoireEdit`, `RepertoireEdit`, `versionRowsSchema` and the now-unused imports (`graphChanges`, `playerMoveChanges`, `recordChanges`, `sql` if unused) from `repository.ts`, and the two names from `src/index.ts`. Update the `repository.ts` header if it mentions the save.
- [ ] **Step 2:** Check:
  - `git grep -n saveRepertoireEdit -- ':!archive' ':!docs'` finds nothing;
  - `git grep -n "ownRepertoire\|applyEdit\|\.version !==" -- "apps/web/src/app/repertuarai/[[]id]/actions.ts"` finds only the rename and delete uses of `ownRepertoire`;
  - `git grep -n "saveRepertoireEdit\|mergeInto" apps/web/src/server/import-preview.ts` finds only the preview's `mergeInto`.
- [ ] **Step 3:** Run the db tests and `pnpm -r typecheck`. Report. The lead runs the gate and commits C1-C3.

---

## Checks before closing #276

- [ ] `qa`: every test the spec lists under "must pass unchanged" passes; `git diff <base> --stat -- '*.test.ts' '*.test.tsx' '*.spec.ts'` lists only the four re-pointed db test files, `statements.ts`, and the new `repertoire-edit.test.ts`, `apply-change.test.ts` and `repertoire.test.ts` cases.
- [ ] E2E in CI: `repertoires.spec.ts`, `sharing.spec.ts`, `assignments.spec.ts` green.
- [ ] `architect`: `mp-code-review` on the whole diff since the base; then `improve-codebase-architecture` on `repertoires/edit.ts`, `apply-change.ts` and what they touched.
- [ ] `security-reviewer`: the owner-only edit path (own scope in SQL plus `canEditRepertoireAt`), the refusal order (no version leaked to a stranger), and the lock strength.
- [ ] Mutation testing in CI green on `apply-change.ts`, `repertoire.ts`, `edit.ts`.
- [ ] The lead closes #276 with the commit links.
