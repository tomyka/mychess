# Edit a repertoire in one place: design

Issue #276 (from the S3 architecture review, owner picked 2026-10-19). Related: #277 (`graphChanges` moved into chess, done in S5), #278 (one repertoire access scope, done), #288 (assignment reach, done).
A deepening refactor with no product change: behaviour, rulings and the meaning of every existing test stay as they are. The issue says "do before S5"; S5 shipped first and already writes `repertoire_changes` from the save, so this refactor keeps that row exactly as it is and adds the `changes` to the return value, the seam S6 reconciliation reads.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-121 | A changed Move is a Move added or removed. A Comment or marks change never resets training. The returned `changes` keep the two apart: `added`/`removed` are changed Moves, `commentsChanged` is only a count |
| R-23, R-53, ADR 0005 | Reconciliation follows from the position keys. The edit writes the minimal diff, so kept Moves keep their rows and keys |
| R-133, R-136 | Every graph edit of a repertoire writes its `repertoire_changes` row in the saving transaction, exactly as `saveRepertoireEdit` does today (S5 plan decision 3: nothing for a chapter rename alone) |
| R-39, R-42, Q26 | Only the owner edits a repertoire. A shared or assigned repertoire is never edited through its share or assignment (`canUseScope`). A missing and a foreign repertoire read the same (S3 decision 12) |
| R-54 | One answer per position: `addMove` and the merge refuse or skip a second answer, as today |
| R-63, R-104 | A chapter's name follows its moves, decided by chess as today |
| R-101, R-115, R-117, R-122 | An import into an existing repertoire of the same side merges the games as new chapters; a file that adds nothing is refused and the repertoire is untouched |
| R-66, R-119 | The upload limits and the import rate limit are checked before the edit, as today |
| R-111 | The first move of a repertoire without chapters creates its first chapter, in one save |
| S3 decision 6, decision 10 | An edit and an import into a repertoire are saved against the version the client holds; a rename bumps no version (rename is not in scope) |

CLAUDE.md "rules live in domain objects; a server action authenticates, loads, calls the domain method that decides, and saves" and "access is decided in the domain and enforced again in queries" are the rules this refactor serves.

## The problem, in the current code

1. **The graph is read twice per edit, outside and inside the lock.**
   - `editRepertoireAction` (`apps/web/src/app/repertuarai/[id]/actions.ts:186-213`) calls `ownRepertoire` (`apps/web/src/server/repertoires.ts:46-58`), which reads the row and the whole graph in a repeatable-read transaction (`loadRepertoire`, `repository.ts:172-185`).
   - It then calls chess's `applyEdit` on that graph and hands the result to `saveRepertoireEdit` (`repository.ts:234-264`), which bumps the version, reads the stored graph again and diffs against it.
   - `importInto` (`apps/web/src/server/import-preview.ts:285-307`, through `mergeIntoOwn` at :244-255) does the same with `mergeInto`.
2. **A rule lives in a server action.** The stale check `repertoire.version !== request.data.version` is in `editRepertoireAction` (:194-195). The import has no such check before merging: it relies on the save's `WHERE version = expected`, so its refusals come in a different order from the builder's.
3. **The save trusts the caller with a graph.** `RepertoireEdit.after` is a whole graph from the caller. The save is safe only because it re-reads `before` (the test "diffs against the stored graph, so a wrong graph from the caller cannot corrupt it" exists for that). Any future caller can pass any graph.
4. **The save returns only `{ version }`.** What the edit changed for players (`playerMoveChanges`) is computed and written, then thrown away. S6 reconciliation and any notice need it.
5. **A deleted or foreign repertoire reads as stale** in the save (`repository.ts:253`), while the action already said not found for it; the two answers depend on timing.

## Lead decisions

1. **One entry point, `editRepertoire(db, { id, viewer, expectedVersion, change, now })`**, in a new `packages/db/src/repertoires/edit.ts`, exported from `@mychess/db`. In one transaction it:
   1. locks the repertoire row through the `own` scope (`repertoireScope(tx, ownScope(viewer.id), 'edit', id)`) with `FOR NO KEY UPDATE`;
   2. asks the domain (`canEditRepertoireAt`) whether this viewer may edit it from `expectedVersion`;
   3. reads the graph once;
   4. asks chess (`applyChange`) for the new graph;
   5. bumps the version and writes the minimal diff (`writeChanges(graphChanges(before, after))`);
   6. records the changes (`recordChanges(playerMoveChanges(before, after))`, unchanged);
   7. returns `{ version, graph, changes, firstChapterId }`.

   `now` is added to the issue's signature because every write here takes its time from the caller, as today.
2. **Lock strength stays `NO KEY UPDATE`.** Today the lock is the one the `UPDATE repertoires SET version` takes, which is `FOR NO KEY UPDATE` (no key column changes). The new locked read takes the same strength, so:
   - an edit still waits for a fork in progress (`fork.ts` reads the repertoire `FOR SHARE`) and a fork still waits for an edit (`forks.test.ts:272`);
   - an assign (`assign.ts:66`, `FOR KEY SHARE`) and a personal note (`personal-notes.ts:84`, `FOR KEY SHARE`) still never wait for an edit;
   - a repertoire delete still waits for an edit and the other way round.

   The edit takes no account row, so the S4/S5 lock order is untouched. The strength is the module's: no caller chooses it.
3. **Refusals, in order:** `repertoire.notFound` (no row through the own scope, or `canEditRepertoire` refuses), then `repertoire.stale` (the version differs), then the change's own refusal from chess. Nothing is written on any refusal. The graph is not read for the first two.
   - For a builder edit this is today's order.
   - For an import confirm, `stale` now comes before `repertoire.sideMismatch` and `pgn.nothingToAdd` when both apply (today the merge ran first). Both stop the import and write nothing; a stale preview has to be redone either way. No test pins the old precedence.
   - A repertoire deleted between the client's load and the save now reads `repertoire.notFound`, not `repertoire.stale`. That is decision 12's answer for a missing repertoire. The builder handles both keys already (`use-builder.ts:73`).
4. **The stale rule moves into the domain**: `canEditRepertoireAt(viewer, repertoire, expectedVersion)` in `packages/domain/src/repertoire.ts`. It returns `canEditRepertoire(viewer, repertoire)` first, then refuses `{ reason: REPERTOIRE_REFUSALS.stale }` when `repertoire.version !== expectedVersion`. A named `RepertoireStaleRefusal` type joins `RepertoireAccessRefusal`.
5. **Chess decides the change**: `applyChange(graph, change)` in a new `packages/chess/src/repertoire/apply-change.ts`. A change is
   - `{ kind: 'edit', op: EditOp }`: one builder edit, decided by `applyEdit`;
   - `{ kind: 'import', imported: ImportedRepertoire }`: decided by `mergeInto`, and refused with `pgn.nothingToAdd` when the merge adds nothing (R-115; today `importInto` does this in web).

   It returns `{ graph, firstChapterId }`: the first chapter an import added, `null` for a builder edit. The refusal type is narrowed by the change's kind (a conditional type), so the builder's refusal union stays exactly today's `EditRefusalKey` and the import's stays today's `ImportRefusalKey`.
6. **The caller never sends a graph.** `saveRepertoireEdit` and `RepertoireEdit` are removed from `@mychess/db` (replace, don't layer). `createRepertoire` stays: it writes a whole new graph and has no version.
7. **The import's parse, limits and rate limit stay outside the lock.** `confirmImport` still counts the rate limit, parses, and runs `importPgn` (the CPU-heavy part, bounded by R-66/R-119) before calling `editRepertoire`. Only `mergeInto` runs under the row lock, as `graphChanges` already does today. The preview (`previewImport`) is a read and stays on `ownRepertoire` + `mergeInto`.
8. **The version bump stays unconditional on success**, as today: a builder edit that changes nothing (adding a move the chapter already has, `addMove` returns the same graph) still bumps the version and writes no `repertoire_changes` row.
9. **Rename and delete are not folded in.** `renameRepertoire` does not touch the graph or the version (decision 10), and `deleteRepertoire` already decides in one transaction. Their actions keep their `ownRepertoire` pre-check, which `repertoire-note-race.test.ts` pins (see "Not in scope").

## Design

### Chess (`packages/chess`)

- **`repertoire/apply-change.ts` (new):**

```ts
export type RepertoireChange =
  | { readonly kind: 'edit'; readonly op: EditOp }
  | { readonly kind: 'import'; readonly imported: ImportedRepertoire };

/** The refusals a change of this kind can come to; each is a catalogue key. */
export type ChangeRefusal<C extends RepertoireChange = RepertoireChange> =
  C extends { readonly kind: 'edit' } ? EditRefusal : MergeRefusal | NothingToAdd;

export interface AppliedChange {
  readonly graph: RepertoireGraph;
  /** The first chapter an import added (the repertoire opens on it); null for a builder edit. */
  readonly firstChapterId: string | null;
}

export function applyChange<C extends RepertoireChange>(
  graph: RepertoireGraph,
  change: C,
): Result<AppliedChange, ChangeRefusal<C>>;
```

- Exported from `src/index.ts` with its types. `applyEdit`, `mergeInto`, `graphChanges` and `playerMoveChanges` are unchanged.

### Domain (`packages/domain`)

- **`repertoire.ts`:**
  - `RepertoireStaleRefusal` (`{ reason: typeof REPERTOIRE_REFUSALS.stale }`);
  - `canEditRepertoireAt(viewer, repertoire, expectedVersion): Result<undefined, RepertoireAccessRefusal | RepertoireStaleRefusal>` (decision 4).
- `canEditRepertoire`, `canUseScope` and the scopes are unchanged.

### Database (`packages/db`)

- **`repertoires/edit.ts` (new):** `editRepertoire` (decision 1) and its types:

```ts
export interface RepertoireEditRequest<C extends RepertoireChange> {
  /** A uuid: the caller parsed it. */
  readonly id: string;
  /** The session account. */
  readonly viewer: Pick<Account, 'id'>;
  /** The version the client computed the change from. */
  readonly expectedVersion: number;
  readonly change: C;
  readonly now: Date;
}

export interface EditedRepertoire {
  readonly version: number;
  /** The graph as saved. */
  readonly graph: RepertoireGraph;
  /** What the edit changed for players (R-121, R-133), as recorded. */
  readonly changes: MoveChanges;
  readonly firstChapterId: string | null;
}

export type EditRepertoireRefusal<C extends RepertoireChange> =
  | RepertoireAccessRefusal
  | RepertoireStaleRefusal
  | ChangeRefusal<C>;

export function editRepertoire<C extends RepertoireChange>(
  db: Executor,
  request: RepertoireEditRequest<C>,
): Promise<Result<EditedRepertoire, EditRepertoireRefusal<C>>>;
```

- **`repertoires/repository.ts`:**
  - gains a package-internal `holdRepertoire(tx, where)`: the meta select of `loadRepertoireRows` with `.for('no key update')`, parsed with `repertoireSchema`, without the graph;
  - `graphRows` becomes package-internal (exported for `edit.ts`, not from the package index);
  - `saveRepertoireEdit`, `RepertoireEdit` and `versionRowsSchema` are removed;
  - the version bump is one `update ... set version = version + 1, updated_at = now where id = $id returning version`, parsed with zod. The row is held, so no version condition is needed; the domain already checked it.
- **`assignments/move-changes.ts`:** `recordChanges` unchanged.
- **`repertoires/write.ts`:** unchanged.
- **`index.ts`:** exports `editRepertoire` and its types; drops `saveRepertoireEdit` and `RepertoireEdit`.
- **No schema change and no migration.**

### Web (`apps/web`)

- **`editRepertoireAction`** authenticates (`requireOnboarded`), parses (`editRequestSchema`), calls `editRepertoire` with `{ kind: 'edit', op }`, and maps the outcome to `EditOutcome`. `ecoNames` is still computed in web from the returned graph and the account's locale (presentation). It no longer imports `ownRepertoire`, `applyEdit` or `saveRepertoireEdit`. `EditOutcome` and `EditRefusalKey` are unchanged.
- **`import-preview.ts` `importInto`** calls `editRepertoire` with `{ kind: 'import', imported }` and `expectedVersion: target.version`, and returns `{ ok: true, id, chapterId: firstChapterId }`. `mergeIntoOwn` stays for the preview only. `ImportRefusalKey` is unchanged.
- The page comment at the top of `actions.ts` and the module comment of `import-preview.ts` say where the decision now lives.

### Statement counts

Counted with `countStatements` (`packages/db/test/support/statements.ts`), BEGIN and COMMIT included. "Graph" is the three reads of `graphRows` (chapters, moves, links).

| Path | Today | After |
| --- | --- | --- |
| Builder edit, one comment changed | 14 in two transactions: load (BEGIN, meta, graph 3, COMMIT) + save (BEGIN, version UPDATE, graph 3, move UPDATE, changes INSERT, COMMIT) | 9 in one: BEGIN, meta FOR NO KEY UPDATE, graph 3, version UPDATE, move UPDATE, changes INSERT, COMMIT |
| Builder edit refused by chess (illegal move) | 6 (the load) | 6 (BEGIN, meta, graph 3, COMMIT) |
| Builder edit, stale version | 6 | 3 (BEGIN, meta, COMMIT) |
| Builder edit, foreign or missing repertoire | 3 | 3 |
| Import into a repertoire | the load (6) + the save | the save + 1: five fewer, whatever the file |

The graph is read once per edit instead of twice, and never for a refusal the row alone decides. The tests prove the shape, not the totals: one `begin` per edit, one read of `move_chapters` per saved edit, none for a stale or not-found one. A later change to `graphRows` does not break them.

## Testing

- **Chess (`apply-change.test.ts`, chess-dev):**
  - an `edit` change gives the same graph as `applyEdit` for each op kind, `firstChapterId: null`, and the same refusal for each `EditRefusal`;
  - an `import` change gives `mergeInto`'s graph and `added.value.firstChapterId`;
  - an import of the other side is refused `repertoire.sideMismatch`;
  - an import that adds nothing (the `merge.test.ts` R-115 / R-117 / R-122 fixtures) is refused `pgn.nothingToAdd`;
  - no property test: `applyChange` delegates to `applyEdit` and `mergeInto`, which keep their own tests and properties (`merge.test.ts`, `training/reconcile-edits.test.ts`); one example per op kind and per refusal kills its mutants.
- **Domain (`repertoire.test.ts`, backend-dev):** a table for `canEditRepertoireAt`: owner at the version (allowed), owner at an older or newer version (stale), another account at the right version (not found), another account at a wrong version (not found: access first).
- **Database (new `test/repertoire-edit.test.ts`, backend-dev):**
  - **behaviour:** a comment edit writes only that move's row (the `xmin` check of `repertoires.test.ts:93`); add and remove moves and links; R-111 in one edit; an import adds chapters after the existing ones and returns the first one added; the returned `changes` equal `playerMoveChanges(before, after)` and equal the recorded row; a chapter rename returns `nothingChanged` changes and writes no row;
  - **refusals write nothing** (version, graph and `repertoire_changes` unchanged): stale; another account's repertoire (`repertoire.notFound`); a missing id; an edit chess refuses; an import of the other side; an import that adds nothing;
  - **decides against the stored graph:** an edit naming a move the stored graph lacks is refused `repertoire.unknownMove`, even when the client's (older) graph had it;
  - **races** (the S5 `openTransaction` / `someoneWaitsForALock` pattern):
    - an edit waits for another edit in progress (an open `update repertoires set version = version + 1`), then is refused stale and writes nothing;
    - an edit waits for a repertoire delete in progress, then is refused not found;
    - an edit waits for a fork's `FOR SHARE` read in progress;
    - an edit does not wait for a `FOR KEY SHARE` hold (an assign or a personal note in progress): it completes while the hold is open;
  - **statement shape:** one `begin` per call; exactly one select from `move_chapters` for a saved edit; none from `repertoire_moves` for a stale or not-found one.
- **Web:** no new test is needed beyond the feature tests below staying green; `editRepertoireAction` and `importInto` keep their outcomes.

### Tests that must pass unchanged

- **Web feature tests (`apps/web/test/feature/`):**
  - `repertoire-edit.test.ts`, every case: R-111 first move, add chapter, the first-move-without-chapter refusal, illegal move and second answer (version kept), remove Bf4 keeping the KID chapter's Bf4, marks and normalised comment, the 2,001-character comment, rename and remove chapter, blank chapter name, **stale version** (:287), **another account as not found** (:299), malformed request, signed-out visitor;
  - `repertoire-import.test.ts`, every case: previews (new, merge, R-115 shown, other side, foreign, malformed, signed out), confirms (new, blank name, **over the limits** (:320), **into an existing repertoire** (:336), **R-115 writes nothing** (:358), **stale version writes nothing** (:372), **foreign and other side** (:393), signed out), and the **R-119 rate limit** block (:431-495);
  - `repertoire-note-race.test.ts` (rename and delete mid-request) and `repertoire-page.test.ts`.
- **Web unit tests:** `repertoire-screen.test.tsx`, `use-builder` users, `importuoti/import-flow.test.tsx`, `importuoti/page.test.tsx` (they mock the actions, whose signatures do not change).
- **Database:**
  - `forks.test.ts:272` (a fork waits for a coach edit in progress and copies the saved graph);
  - `assignment-player.test.ts` "updated" and `changesSince` blocks (:190-330, :602-780) in meaning; only their `coachEdit` helper changes shape (below);
  - `repertoire-scope.test.ts` (edit is the owner only, :165);
  - `repertoires.test.ts` create/load, list/rename/delete blocks;
  - every race and lock test listed in `2026-10-22-assignment-reach-design.md` ("Lock order"), since `assign` and personal notes take the repertoire `FOR KEY SHARE`.
- **Chess:** `edit.test.ts`, `merge.test.ts`, `changes.test.ts` unchanged.
- **E2E:** `repertoires.spec.ts` (builder and import journeys), `sharing.spec.ts`, `assignments.spec.ts` (a coach edit shows "Updated" with the summary).

### Tests that change shape, not meaning

They called `saveRepertoireEdit` with a whole graph, which no longer exists. Each is re-pointed to `editRepertoire` with the op (or ops) that made that graph; the assertions stay, except where noted.

- **`packages/db/test/repertoires.test.ts`** (the two `saveRepertoireEdit` blocks move to `repertoire-edit.test.ts`):
  - :93 "writes only the rows that changed, and bumps the version": one `editComment` op; same assertions;
  - :117 "adds and removes moves and links": two edits (`removeMove` from version 1, `addMove` from version 2); the final graph equals the same expected graph;
  - :138 R-111: one `addMove` with `chapterId: null`; same assertions;
  - :162 "diffs against the stored graph, so a wrong graph from the caller cannot corrupt it": the interface no longer takes a graph, so it becomes "decides against the stored graph" (above);
  - :185 stale: same assertions;
  - "refuses another account's repertoire as stale and writes nothing": the reason is now `repertoire.notFound` (decision 3); the test asserted only `ok: false` and the untouched graph, which stay;
  - R-133 block (:266-307): the `saveEdit` helper takes ops. "writes the player move changes": `Bd6` then `Bd3` as two edits; `Bd6` is an opponent move and records nothing, so there is still exactly one row, now at version 3 instead of 2. The rename and comment cases are one op each, unchanged.
- **`packages/db/test/assignment-player.test.ts`:** the `coachEdit` helper (:93-110) takes an op builder `(graph) => EditOp` and calls `editRepertoire` at the stored version. `addE3`, `removeE3`, `removeBf4`, `addC4` and `commentD4` become op builders. The composed edit at :678 becomes two `coachEdit` calls; `changesSince` nets them to the same expected value.
- **`packages/db/test/forks.test.ts:299`:** the coach's later edit is one `addMove` op through `editRepertoire`.
- **`packages/db/test/personal-notes.test.ts:139`:** removing 1. d4 from c1 and c2 becomes two edits (versions 1 and 2); same assertions.

## Not in scope

- **Rename and delete actions** keep their `ownRepertoire` pre-check (decision 9). Both load the whole graph only to check ownership; a later issue can move them onto a meta-only check, re-pointing `repertoire-note-race.test.ts`.
- **One diff instead of two.** `editRepertoire` calls `graphChanges` and then `playerMoveChanges`, which calls `graphChanges` again. A chess helper deriving player changes from one `GraphChanges` is a "could be better", not a rule.
- **S6 reconciliation** reads `changes` (or `repertoire_changes`); this issue only provides them.
- **The preview** stays a read (`ownRepertoire` + `mergeInto`).
- **No change to `CONTEXT.md`.** "Change" and "edit" stay code words; `RepertoireChange` is not a domain term.

## Done means

- `editRepertoire` is the only way to change an existing repertoire's graph. A grep for `saveRepertoireEdit` finds nothing outside `archive/` and older plans.
- `editRepertoireAction` and `importInto` authenticate, parse and call `editRepertoire`; neither imports `ownRepertoire`, `applyEdit` or a db writer other than `editRepertoire`. No version comparison remains in `apps/web`.
- The stale rule is in the domain (`canEditRepertoireAt`); the change rule is in chess (`applyChange`).
- `editRepertoire` returns `{ version, graph, changes, firstChapterId }`, and `changes` equals the recorded `repertoire_changes` row.
- The new db tests pass: behaviour, refusals, races and statement shape.
- Every test listed under "must pass unchanged" passes byte for byte; only those under "change shape" changed.
- Mutation testing in CI is green on `apply-change.ts`, `repertoire.ts` and `edit.ts`.
- The gate is green. `security-reviewer` signs off (the owner-only edit path moved into db).
- #276 closes.
