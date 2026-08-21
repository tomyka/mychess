# Coach Repertoire Re-upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach upload a revised PGN onto an existing repertoire, reviewing a classified diff and its cost to students before anything is written, without wiping the progress of lines that did not change.

**Architecture:** Update in place on the same repertoire row — because `moves` upsert on `(repertoire_id, from_position, san)`, every unchanged edge keeps its UUID, so every unchanged variation keeps its `variation_key` and its progress for free. Lines that did change are classified into five classes by a pure module, and each student's progress is carried forward by longest-common-prefix on the next load they perform. Removed lines are retired (`retired_at`), never deleted, because `moves.id` is `on delete cascade` from `reviews` and `move_attempts`.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Supabase (Postgres + PostgREST via `supabase-js`), Tailwind 4, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-coach-repertoire-reupload-design.md`. **Issue:** [#118](https://github.com/tomyka/mychess/issues/118).

---

## Read this before Task 1

Facts about this codebase that the tasks below depend on. Getting these wrong produces silently-wrong code that still passes its own tests.

- **All `npm` commands run from `mychess/`**, not the repo root. The git root is one level above.
- **`variation_key` is a `>`-joined chain of move UUIDs**, one per ply, root to leaf. `moveIdsInVariationKey(key)` in `src/lib/mastery/variations.ts` splits it. Ply count == move-id count.
- **Pure logic lives in `src/lib/`** with a colocated `*.test.ts`. **Anything touching Supabase lives in `src/lib/server/`** and is conventionally *not* unit-tested directly — it is exercised through the pure tests plus manual verification. Do not fight this split; it is why the diff engine is pure.
- **`repertoires.moves_updated_at` is maintained by database triggers** (`touch_repertoire_moves_updated_at`, migration 0055) on INSERT, UPDATE and DELETE of `moves`. Never set it from application code. An `UPDATE` that only sets `retired_at` bumps it, which is exactly what we want.
- **`reverifyExclusions` (`src/lib/server/repertoire-progress.ts:132`) deletes exclusion rows whose key no longer names a live variation.** Reconciliation must run *before* it and rewrite those keys, or a student's "skip this line" is destroyed on any line the coach merely extended. Task 8 pins this ordering with a test.
- **Migrations cannot be applied from this environment.** Write the file, then hand its contents to the user to paste into the Supabase dashboard SQL editor. Do not assume it took effect — ask for confirmation before any task that depends on it.
- **A `SUPABASE_SERVICE_ROLE_KEY` exists in `mychess/.env`** for direct data-level verification via PostgREST, but Bash cannot read `.env` or run scripts that load it. Ask the user to run such commands with the `!` prefix.
- `npm run check` and `npm run lint` must both be clean before pushing. No tolerated baseline.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `src/lib/repertoire-diff.ts` | Pure. Classifies existing vs incoming variations into the five classes; detects renames; projects progress impact. No Supabase. |
| `src/lib/repertoire-diff.test.ts` | The real coverage for the above. |
| `src/lib/repertoire-reconcile.ts` | Pure. Given a diff plus one player's progress rows, computes the exact row mutations to apply. No Supabase. |
| `src/lib/repertoire-reconcile.test.ts` | Coverage for the above. |
| `src/lib/server/repertoire-update.ts` | I/O. Fetches current state, calls the pure diff, invokes the apply RPC. |
| `src/lib/server/repertoire-reconcile.ts` | I/O. Runs one player's reconciliation and stamps it. |
| `supabase/migrations/0062_repertoire_update.sql` | `moves.retired_at`, `repertoire_reconciliation`, widened `variation_demotions.cause`, `apply_repertoire_update`. |
| `src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.svelte` | The review screen. |
| `src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.server.ts` | Its loader + apply action. |
| `src/lib/components/RepertoireDiffReview.svelte` | The review UI proper, so the route file stays thin and the component is testable. |
| `src/lib/components/RepertoireUpdatedBanner.svelte` | Student-facing "your coach updated this" notice. |

**Modify:**

| Path | Change |
|---|---|
| `src/lib/server/practice-repertoire.ts:39-51` | `fetchAllMoves` filters `retired_at is null`. Single funnel for every `enumerateVariations` caller. |
| `src/lib/server/practice-pool.ts` | Its own `moves` reads filter retired. |
| `src/routes/(player)/drill/+page.server.ts` | Same. |
| `src/lib/server/repertoire-progress.ts` | Call reconciliation before `reverifyExclusions`; its private `fetchAllMoves` (line 49) also filters retired. |
| `src/routes/(coach)/coach/repertoires/[repertoire_id]/+page.svelte` | "Update from file" entry point. |

Tasks 1–2 and 3–4 are independently shippable and carry no user-visible behaviour change, which is where the real risk sits. Do them first and separately.

---

### Task 1: Retire filter on the read path

No `retired_at` column exists yet, so this task is a no-op in behaviour — which is exactly why it goes first, alone. It is the change with the widest reach across read paths.

**Files:**
- Modify: `mychess/supabase/migrations/0062_repertoire_update.sql` (create, column only for now)
- Modify: `mychess/src/lib/server/practice-repertoire.ts:39-51`
- Modify: `mychess/src/lib/server/repertoire-progress.ts:49`

- [ ] **Step 1: Write the migration file, column only**

Create `mychess/supabase/migrations/0062_repertoire_update.sql`:

```sql
-- mychess/supabase/migrations/0062_repertoire_update.sql
-- Coach repertoire re-upload (issue #118). See
-- ../docs/superpowers/specs/2026-08-21-coach-repertoire-reupload-design.md
--
-- A line the coach removed is RETIRED, not deleted. `moves.id` is referenced
-- `on delete cascade` by `reviews` (0001) and `move_attempts` (0039), so
-- deleting a pruned move destroys the student's SRS scheduling state along
-- with it, unrecoverably. Retiring also makes the whole update
-- non-destructive: prune becomes an UPDATE, so a failed apply cannot lose
-- data, and a removed-then-restored line comes back with its history.
--
-- Note this UPDATE fires 0055's `moves_touch_repertoire_update` trigger, so
-- `repertoires.moves_updated_at` bumps with no application-side help. That is
-- deliberate — it is the staleness signal reconciliation reads.
alter table public.moves
  add column if not exists retired_at timestamptz;

create index if not exists moves_repertoire_live_idx
  on public.moves (repertoire_id)
  where retired_at is null;
```

- [ ] **Step 2: Hand the migration to the user**

Print the file contents and ask the user to paste it into the Supabase dashboard SQL editor. Wait for confirmation before Step 3 — the filter in Step 3 references a column that must exist.

- [ ] **Step 3: Filter retired moves in `fetchAllMoves`**

In `mychess/src/lib/server/practice-repertoire.ts`, both the page query and the count query need the filter — a count that includes retired rows makes `fetchAllPages` page past the end:

```ts
export async function fetchAllMoves(supabase: SupabaseClient, repertoireId: string): Promise<any[]> {
	return fetchAllPages(
		() =>
			supabase
				.from('moves')
				.select(MOVE_SELECT_COLUMNS)
				.eq('repertoire_id', repertoireId)
				.is('retired_at', null)
				.order('created_at', { ascending: true })
				.order('id', { ascending: true }),
		() =>
			supabase
				.from('moves')
				.select('id', { count: 'exact', head: true })
				.eq('repertoire_id', repertoireId)
				.is('retired_at', null),
		MOVES_PAGE_SIZE
	);
}
```

- [ ] **Step 4: Apply the same filter to `repertoire-progress.ts`'s private fetch**

Read `mychess/src/lib/server/repertoire-progress.ts:49-68` first — it fetches for *many* repertoires at once (`repIds: string[]`), so the shape differs from Step 3. Add `.is('retired_at', null)` to both its page query and its count query, matching whatever `.in('repertoire_id', ...)` filter is already there. Do not restructure the function.

- [ ] **Step 5: Run the full suite**

From `mychess/`:

```bash
npm test && npm run check && npm run lint
```

Expected: all pass, zero errors from `check` and `lint`. No test asserts on retired moves yet, and `retired_at` is null everywhere, so behaviour is unchanged.

- [ ] **Step 6: Commit**

```bash
git add mychess/supabase/migrations/0062_repertoire_update.sql \
        mychess/src/lib/server/practice-repertoire.ts \
        mychess/src/lib/server/repertoire-progress.ts
git commit -m "feat(repertoire): add moves.retired_at and filter it from read paths (#118)"
```

---

### Task 2: Retire filter on the remaining move readers

**Files:**
- Modify: `mychess/src/lib/server/practice-pool.ts`
- Modify: `mychess/src/routes/(player)/drill/+page.server.ts`

- [ ] **Step 1: Find every direct `moves` read outside `fetchAllMoves`**

```bash
cd mychess && grep -rn "from('moves')" src/
```

Expected: hits in `src/lib/server/practice-repertoire.ts` (done in Task 1), `src/lib/server/repertoire-progress.ts` (done), `src/lib/server/pgn-import.ts` (a *write* path — its existing-rows lookup must see retired rows so a restored line is reused rather than duplicated; **leave it alone**), plus `practice-pool.ts` and `drill/+page.server.ts`.

- [ ] **Step 2: Add the filter to each remaining read**

For every `select` on `moves` in `practice-pool.ts` and `drill/+page.server.ts`, add `.is('retired_at', null)`. If the query has a paired `count` query, filter that too, for the reason in Task 1 Step 3.

- [ ] **Step 3: Run the suite**

```bash
npm test && npm run check && npm run lint
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/server/practice-pool.ts "mychess/src/routes/(player)/drill/+page.server.ts"
git commit -m "feat(repertoire): filter retired moves from practice pool and drill (#118)"
```

---

### Task 3: Diff classification — unchanged, extended, truncated

The pure core. Three classes first, then the harder two in Task 4, so each commit is small.

**Files:**
- Create: `mychess/src/lib/repertoire-diff.ts`
- Create: `mychess/src/lib/repertoire-diff.test.ts`

Incoming variations have no move ids (their moves are not written yet), so the two sides are compared on different identifiers: existing lines by move-id path, incoming by SAN path. The bridge is that both carry `path: VariationStep[]`, and `VariationStep.san` exists on both.

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/repertoire-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyVariations, type ExistingLine, type IncomingLine } from './repertoire-diff';

/** A line as the DB has it: move ids plus the SAN at each ply. */
function existing(ids: string[], sans: string[]): ExistingLine {
	return { variationKey: ids.join('>'), sans, chapterNames: [] };
}

/** A line as the upload has it: SAN only, no ids yet. */
function incoming(sans: string[]): IncomingLine {
	return { sans, chapterNames: [] };
}

const NAJDORF = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
const IDS = NAJDORF.map((_, i) => `m${i}`);

describe('classifyVariations', () => {
	it('marks an identical line unchanged and keeps its key', () => {
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(NAJDORF)]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('unchanged');
		expect(result[0].existingKey).toBe(IDS.join('>'));
	});

	it('marks a longer line extended, with the common prefix in plies', () => {
		const longer = [...NAJDORF, 'Be3', 'e5'];
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(longer)]);
		expect(result[0].kind).toBe('extended');
		expect(result[0].commonPlies).toBe(10);
	});

	it('marks a shorter line truncated', () => {
		const shorter = NAJDORF.slice(0, 8);
		const result = classifyVariations([existing(IDS, NAJDORF)], [incoming(shorter)]);
		expect(result[0].kind).toBe('truncated');
		expect(result[0].commonPlies).toBe(8);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd mychess && npx vitest run src/lib/repertoire-diff.test.ts
```

Expected: FAIL — `Failed to resolve import "./repertoire-diff"`.

- [ ] **Step 3: Write the minimal implementation**

Create `mychess/src/lib/repertoire-diff.ts`:

```ts
/**
 * Pure classification of a repertoire re-upload against the repertoire's
 * current state. No Supabase — see `src/lib/server/repertoire-update.ts` for
 * the I/O that feeds this.
 *
 * The two sides are keyed differently on purpose: existing lines carry move
 * UUIDs (their `variationKey`), incoming lines carry only SAN, because their
 * moves are not written yet. Comparison therefore happens on the SAN path,
 * which both sides have, and `existingKey` is carried through so the caller
 * can find the progress rows belonging to a matched line.
 */

/** A line as it exists in the database. `sans` is one entry per ply, root to leaf. */
export type ExistingLine = {
	variationKey: string;
	sans: string[];
	chapterNames: string[];
};

/** A line as it appears in the uploaded PGN. No ids — its moves are unwritten. */
export type IncomingLine = {
	sans: string[];
	chapterNames: string[];
};

export type DiffKind = 'unchanged' | 'extended' | 'truncated' | 'diverged' | 'new' | 'removed';

export type VariationDiff = {
	kind: DiffKind;
	/** Present for every kind except `new` — the key whose progress rows this concerns. */
	existingKey: string | null;
	/** The line as it will exist after the update. Null for `removed`. */
	sans: string[] | null;
	/**
	 * Plies the two versions share. For `unchanged` this is the full length; for
	 * `new` it is the longest prefix shared with ANY existing line (the
	 * inheritance depth); for `removed` it is 0.
	 */
	commonPlies: number;
};

/** How many leading plies two SAN paths share. */
export function commonPrefixLength(a: string[], b: string[]): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

export function classifyVariations(existing: ExistingLine[], incoming: IncomingLine[]): VariationDiff[] {
	const diffs: VariationDiff[] = [];

	for (const inc of incoming) {
		// The existing line this one most plausibly descends from: longest
		// shared prefix wins, and among equals the shorter existing line, so a
		// line that is a clean prefix of the upload reads as extended rather
		// than as an arbitrary sibling.
		let best: { line: ExistingLine; shared: number } | null = null;
		for (const ex of existing) {
			const shared = commonPrefixLength(ex.sans, inc.sans);
			if (!best || shared > best.shared || (shared === best.shared && ex.sans.length < best.line.sans.length)) {
				best = { line: ex, shared };
			}
		}

		if (!best || best.shared === 0) {
			diffs.push({ kind: 'new', existingKey: null, sans: inc.sans, commonPlies: 0 });
			continue;
		}

		const ex = best.line;
		if (best.shared === ex.sans.length && best.shared === inc.sans.length) {
			diffs.push({ kind: 'unchanged', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else if (best.shared === ex.sans.length) {
			diffs.push({ kind: 'extended', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else if (best.shared === inc.sans.length) {
			diffs.push({ kind: 'truncated', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		} else {
			diffs.push({ kind: 'diverged', existingKey: ex.variationKey, sans: inc.sans, commonPlies: best.shared });
		}
	}

	return diffs;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/repertoire-diff.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/repertoire-diff.ts mychess/src/lib/repertoire-diff.test.ts
git commit -m "feat(repertoire): classify unchanged, extended and truncated lines (#118)"
```

---

### Task 4: Diff classification — diverged, new siblings, removed

The cases most likely to be got wrong. Each test here corresponds to a specific way a naive implementation breaks.

**Files:**
- Modify: `mychess/src/lib/repertoire-diff.ts`
- Modify: `mychess/src/lib/repertoire-diff.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `mychess/src/lib/repertoire-diff.test.ts`:

```ts
describe('classifyVariations — divergence and new lines', () => {
	const BASE = [...NAJDORF, 'Be3', 'e5', 'Nf3', 'Qc7'];
	const BASE_IDS = BASE.map((_, i) => `m${i}`);

	it('marks a mid-line change diverged at the shared prefix', () => {
		// ...7.Nf3 Qc7 8.a4 becomes 8.Bd3 — diverges at ply 14.
		const before = [...BASE, 'a4'];
		const after = [...BASE, 'Bd3', 'Be7'];
		const result = classifyVariations([existing([...BASE_IDS, 'm14'], before)], [incoming(after)]);
		expect(result[0].kind).toBe('diverged');
		expect(result[0].commonPlies).toBe(14);
	});

	it('classifies a divergence on the OPPONENT ply, not just the player ply', () => {
		// White (the opponent, for a Black repertoire) plays 8.Bd3 instead of
		// 8.a4 — same arithmetic, but a naive "only count player moves"
		// implementation reports the wrong depth here.
		const before = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be6'];
		const after = [...NAJDORF, 'Be3', 'e5', 'f3', 'Be6'];
		const ids = before.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, before)], [incoming(after)]);
		expect(result[0].kind).toBe('diverged');
		expect(result[0].commonPlies).toBe(12);
	});

	it('gives a new sibling the inheritance depth of its shared prefix', () => {
		// 7...Be7 added beside the existing 7...Be6. The sibling shares 11
		// plies, so the student must not replay 1.e4 through 7.Nb3.
		const kept = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be6'];
		const sibling = [...NAJDORF, 'Be3', 'e5', 'Nb3', 'Be7', 'Qd2'];
		const ids = kept.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, kept)], [incoming(kept), incoming(sibling)]);
		const newLine = result.find((r) => r.kind === 'new');
		expect(newLine).toBeDefined();
		expect(newLine!.commonPlies).toBe(11);
		expect(result.find((r) => r.kind === 'unchanged')).toBeDefined();
	});

	it('reports an existing line absent from the upload as removed', () => {
		const gone = [...NAJDORF, 'Be3', 'e6', 'Qd2', 'b5'];
		const kept = [...NAJDORF, 'Be3', 'e5'];
		const result = classifyVariations(
			[existing(gone.map((_, i) => `g${i}`), gone), existing(kept.map((_, i) => `k${i}`), kept)],
			[incoming(kept)]
		);
		const removed = result.filter((r) => r.kind === 'removed');
		expect(removed).toHaveLength(1);
		expect(removed[0].existingKey).toBe(gone.map((_, i) => `g${i}`).join('>'));
		expect(removed[0].sans).toBeNull();
	});

	it('does not report a line as removed when another line claimed it as its ancestor', () => {
		// The extended case: the old shorter line is not "removed", it grew.
		// Emitting both `extended` and `removed` for it would double-count and
		// retire moves the upload still uses.
		const before = [...NAJDORF, 'Be3', 'e5'];
		const after = [...before, 'Nb3', 'Be6'];
		const ids = before.map((_, i) => `m${i}`);
		const result = classifyVariations([existing(ids, before)], [incoming(after)]);
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('extended');
	});
});
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
npx vitest run src/lib/repertoire-diff.test.ts
```

Expected: the first three pass already (the Task 3 implementation handles them), the two `removed` tests FAIL — `classifyVariations` never emits `removed`.

If the *sibling* test also fails, the cause is the tie-break in Step 3 of Task 3: check that the shorter existing line wins among equal prefixes.

- [ ] **Step 3: Emit `removed` for unclaimed existing lines**

In `mychess/src/lib/repertoire-diff.ts`, track which existing lines were matched, then append the unmatched ones. Replace the `return diffs;` at the end of `classifyVariations` with:

```ts
	const claimed = new Set(diffs.map((d) => d.existingKey).filter((k): k is string => k !== null));
	for (const ex of existing) {
		if (claimed.has(ex.variationKey)) continue;
		diffs.push({ kind: 'removed', existingKey: ex.variationKey, sans: null, commonPlies: 0 });
	}

	return diffs;
```

`claimed` is what keeps an extended line from being reported as removed as well: the `extended` entry already carries its `existingKey`, so the old shorter line counts as claimed.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/lib/repertoire-diff.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Add the transposition guard test**

`enumerateVariations` merges lines by `variationKey`, so two chapters sharing a tail are ONE variation carrying both chapter names — never two lines with one key. Pin that the diff preserves it:

```ts
it('treats a line shared by two chapters as one line carrying both names', () => {
	const shared = [...NAJDORF, 'Be3', 'e5'];
	const ids = shared.map((_, i) => `m${i}`);
	const result = classifyVariations(
		[{ variationKey: ids.join('>'), sans: shared, chapterNames: ['6.Bg5', '6.Be3'] }],
		[{ sans: shared, chapterNames: ['6.Bg5', '6.Be3'] }]
	);
	expect(result).toHaveLength(1);
	expect(result[0].kind).toBe('unchanged');
});
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/lib/repertoire-diff.test.ts && npm run check && npm run lint
git add mychess/src/lib/repertoire-diff.ts mychess/src/lib/repertoire-diff.test.ts
git commit -m "feat(repertoire): classify diverged, new-sibling and removed lines (#118)"
```

---

### Task 5: Rename detection

**Files:**
- Modify: `mychess/src/lib/repertoire-diff.ts`
- Modify: `mychess/src/lib/repertoire-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `mychess/src/lib/repertoire-diff.test.ts`:

```ts
import { detectRenames, RENAME_THRESHOLD } from './repertoire-diff';

describe('detectRenames', () => {
	// Six lines in the old chapter; five of them reappear under the new name.
	const lines = (n: number) => Array.from({ length: n }, (_, i) => [`e4`, `c5`, `Nf3`, `x${i}`]);

	it('offers a rename when overlap is at or above the threshold', () => {
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[{ name: 'Najdorf — Amsterdam Variation (6.f4)', lines: lines(5) }]
		);
		expect(result).toHaveLength(1);
		expect(result[0].from).toBe('Najdorf — 6.f4');
		expect(result[0].to).toBe('Najdorf — Amsterdam Variation (6.f4)');
		expect(result[0].overlap).toBeCloseTo(5 / 6);
	});

	it('offers nothing below the threshold rather than a bad guess', () => {
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[{ name: 'Something else', lines: lines(2) }]
		);
		expect(result).toEqual([]);
	});

	it('offers nothing when two new chapters both qualify', () => {
		// Ambiguous: the coach resolves it manually rather than being handed a
		// coin-flip presented as a default.
		const result = detectRenames(
			[{ name: 'Najdorf — 6.f4', lines: lines(6) }],
			[
				{ name: 'Amsterdam A', lines: lines(6) },
				{ name: 'Amsterdam B', lines: lines(6) }
			]
		);
		expect(result).toEqual([]);
	});

	it('uses a threshold of 0.7', () => {
		expect(RENAME_THRESHOLD).toBe(0.7);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/repertoire-diff.test.ts -t detectRenames
```

Expected: FAIL — `detectRenames` is not exported.

- [ ] **Step 3: Implement**

Append to `mychess/src/lib/repertoire-diff.ts`:

```ts
/**
 * Minimum share of an absent chapter's lines that must reappear under a new
 * chapter's name before a rename is offered. Below this, offering nothing
 * beats offering a guess: a wrong rename accepted by a coach clicking through
 * silently merges two unrelated chapters.
 */
export const RENAME_THRESHOLD = 0.7;

export type ChapterLines = { name: string; lines: string[][] };
export type RenameCandidate = { from: string; to: string; overlap: number };

/**
 * Pairs each chapter absent from the upload with the new chapter that most
 * covers its lines, when exactly one clears `RENAME_THRESHOLD`. Two qualifying
 * candidates yield nothing — see the ambiguity test.
 */
export function detectRenames(absent: ChapterLines[], added: ChapterLines[]): RenameCandidate[] {
	const candidates: RenameCandidate[] = [];

	for (const gone of absent) {
		if (gone.lines.length === 0) continue;
		const goneKeys = new Set(gone.lines.map((l) => l.join(' ')));

		const qualifying = added
			.map((add) => {
				const matched = add.lines.filter((l) => goneKeys.has(l.join(' '))).length;
				return { from: gone.name, to: add.name, overlap: matched / gone.lines.length };
			})
			.filter((c) => c.overlap >= RENAME_THRESHOLD);

		if (qualifying.length === 1) candidates.push(qualifying[0]);
	}

	return candidates;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/repertoire-diff.test.ts
```

Expected: 13 passed.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/repertoire-diff.ts mychess/src/lib/repertoire-diff.test.ts
git commit -m "feat(repertoire): detect chapter renames by line overlap (#118)"
```

---

### Task 6: Progress carry-forward arithmetic

Given a diff and one player's progress rows, compute the exact mutations. Pure, so it serves both the coach's projection and the student's reconciliation.

**Files:**
- Create: `mychess/src/lib/repertoire-reconcile.ts`
- Create: `mychess/src/lib/repertoire-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/repertoire-reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planReconciliation, type PlayerProgress } from './repertoire-reconcile';
import type { VariationDiff } from './repertoire-diff';

const OLD_KEY = 'm0>m1>m2>m3';
const NEW_KEY = 'n0>n1>n2>n3>n4>n5';

function progress(over: Partial<PlayerProgress> = {}): PlayerProgress {
	return { teaching: [], solved: [], excluded: [], activeVariationKey: null, ...over };
}

describe('planReconciliation', () => {
	it('touches nothing for an unchanged line', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'unchanged', existingKey: OLD_KEY, sans: ['e4'], commonPlies: 4 }
		];
		const plan = planReconciliation(diffs, new Map([[OLD_KEY, OLD_KEY]]), progress({
			teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 2 }],
			solved: [OLD_KEY]
		}));
		expect(plan.teachingUpdates).toEqual([]);
		expect(plan.demotions).toEqual([]);
	});

	it('keeps depth but demotes learned for an extended line', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'extended', existingKey: OLD_KEY, sans: [], commonPlies: 4 }
		];
		const plan = planReconciliation(diffs, new Map([[OLD_KEY, NEW_KEY]]), progress({
			teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 2 }],
			solved: [OLD_KEY]
		}));
		expect(plan.teachingUpdates).toEqual([
			{ fromKey: OLD_KEY, toKey: NEW_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 0 }
		]);
		expect(plan.demotions).toEqual([{ variationKey: NEW_KEY, cause: 'coach_update' }]);
	});

	it('clamps depth down to the common prefix for a diverged line', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'diverged', existingKey: OLD_KEY, sans: [], commonPlies: 2 }
		];
		const plan = planReconciliation(diffs, new Map([[OLD_KEY, NEW_KEY]]), progress({
			teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 1 }],
			solved: [OLD_KEY]
		}));
		expect(plan.teachingUpdates[0].taughtPlies).toBe(2);
		expect(plan.teachingUpdates[0].masteredPlies).toBe(2);
		expect(plan.demotions).toHaveLength(1);
	});

	it('leaves learned intact for a truncated line', () => {
		// The student already knew more than the line now asks for.
		const diffs: VariationDiff[] = [
			{ kind: 'truncated', existingKey: OLD_KEY, sans: [], commonPlies: 2 }
		];
		const plan = planReconciliation(diffs, new Map([[OLD_KEY, NEW_KEY]]), progress({
			teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 2 }],
			solved: [OLD_KEY]
		}));
		expect(plan.demotions).toEqual([]);
		expect(plan.solvedMoves).toEqual([{ fromKey: OLD_KEY, toKey: NEW_KEY }]);
		expect(plan.teachingUpdates[0].taughtPlies).toBe(2);
	});

	it('seeds a new sibling from its inherited prefix', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'new', existingKey: null, sans: [], commonPlies: 11 }
		];
		const plan = planReconciliation(diffs, new Map([['', NEW_KEY]]), progress());
		expect(plan.teachingInserts).toEqual([
			{ variationKey: NEW_KEY, taughtPlies: 11, masteredPlies: 11 }
		]);
	});

	it('rewrites an exclusion onto the new key instead of dropping it', () => {
		// reverifyExclusions would DELETE this row for having a stale key. The
		// student said "skip this line"; a coach fixing a typo must not undo that.
		const diffs: VariationDiff[] = [
			{ kind: 'extended', existingKey: OLD_KEY, sans: [], commonPlies: 4 }
		];
		const plan = planReconciliation(diffs, new Map([[OLD_KEY, NEW_KEY]]), progress({ excluded: [OLD_KEY] }));
		expect(plan.exclusionMoves).toEqual([{ fromKey: OLD_KEY, toKey: NEW_KEY }]);
	});

	it('clears the active variation when it points at a removed line', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'removed', existingKey: OLD_KEY, sans: null, commonPlies: 0 }
		];
		const plan = planReconciliation(diffs, new Map(), progress({ activeVariationKey: OLD_KEY }));
		expect(plan.clearActiveVariation).toBe(true);
	});

	it('keeps progress rows for a removed line so restoring it restores state', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'removed', existingKey: OLD_KEY, sans: null, commonPlies: 0 }
		];
		const plan = planReconciliation(diffs, new Map(), progress({
			teaching: [{ variationKey: OLD_KEY, taughtPlies: 4, masteredPlies: 4, cleanPassCount: 2 }],
			solved: [OLD_KEY]
		}));
		expect(plan.teachingDeletes).toEqual([]);
		expect(plan.solvedDeletes).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/repertoire-reconcile.test.ts
```

Expected: FAIL — `Failed to resolve import "./repertoire-reconcile"`.

- [ ] **Step 3: Implement**

Create `mychess/src/lib/repertoire-reconcile.ts`:

```ts
import type { VariationDiff } from './repertoire-diff';

/**
 * Pure carry-forward arithmetic: given a classified diff, the old-key to
 * new-key mapping the apply step produced, and ONE player's progress, compute
 * the exact mutations. Same function serves the coach's projection (run
 * against each student's rows to count the cost) and the student's own
 * reconciliation, so the number the coach saw and the change the student gets
 * cannot drift.
 */

export type TeachingRow = {
	variationKey: string;
	taughtPlies: number;
	masteredPlies: number;
	cleanPassCount: number;
};

export type PlayerProgress = {
	teaching: TeachingRow[];
	/** Variation keys with a `variation_solved` row — i.e. learned. */
	solved: string[];
	/** Variation keys with a `variation_practice_exclusions` row. */
	excluded: string[];
	activeVariationKey: string | null;
};

export type ReconciliationPlan = {
	teachingUpdates: Array<{
		fromKey: string;
		toKey: string;
		taughtPlies: number;
		masteredPlies: number;
		cleanPassCount: number;
	}>;
	teachingInserts: Array<{ variationKey: string; taughtPlies: number; masteredPlies: number }>;
	teachingDeletes: string[];
	/** Learned status carried onto the new key unchanged. */
	solvedMoves: Array<{ fromKey: string; toKey: string }>;
	solvedDeletes: string[];
	demotions: Array<{ variationKey: string; cause: 'coach_update' }>;
	exclusionMoves: Array<{ fromKey: string; toKey: string }>;
	clearActiveVariation: boolean;
};

/** `learned` survives only where the new line is fully inside what was already learned. */
const KEEPS_LEARNED: ReadonlySet<string> = new Set(['unchanged', 'truncated']);

export function planReconciliation(
	diffs: VariationDiff[],
	/** old `variationKey` -> new `variationKey`, from the apply step. */
	keyMap: ReadonlyMap<string, string>,
	progress: PlayerProgress
): ReconciliationPlan {
	const plan: ReconciliationPlan = {
		teachingUpdates: [],
		teachingInserts: [],
		teachingDeletes: [],
		solvedMoves: [],
		solvedDeletes: [],
		demotions: [],
		exclusionMoves: [],
		clearActiveVariation: false
	};

	const teachingByKey = new Map(progress.teaching.map((t) => [t.variationKey, t]));
	const solved = new Set(progress.solved);
	const excluded = new Set(progress.excluded);

	for (const diff of diffs) {
		if (diff.kind === 'removed') {
			// Rows are deliberately kept — restoring the line restores its state.
			if (progress.activeVariationKey === diff.existingKey) plan.clearActiveVariation = true;
			continue;
		}

		if (diff.kind === 'new') {
			const toKey = keyMap.get('') ?? null;
			if (toKey && diff.commonPlies > 0) {
				plan.teachingInserts.push({
					variationKey: toKey,
					taughtPlies: diff.commonPlies,
					masteredPlies: diff.commonPlies
				});
			}
			continue;
		}

		const fromKey = diff.existingKey!;
		const toKey = keyMap.get(fromKey);
		if (!toKey) continue;

		const row = teachingByKey.get(fromKey);
		if (row) {
			plan.teachingUpdates.push({
				fromKey,
				toKey,
				taughtPlies: Math.min(row.taughtPlies, diff.commonPlies),
				masteredPlies: Math.min(row.masteredPlies, diff.commonPlies),
				// A clean-pass streak is over the line's FINAL batch. A line whose
				// end moved has no surviving streak, so it restarts — while the
				// depth above is kept.
				cleanPassCount: KEEPS_LEARNED.has(diff.kind) ? row.cleanPassCount : 0
			});
		}

		if (solved.has(fromKey)) {
			if (KEEPS_LEARNED.has(diff.kind)) {
				plan.solvedMoves.push({ fromKey, toKey });
			} else {
				plan.solvedDeletes.push(fromKey);
				plan.demotions.push({ variationKey: toKey, cause: 'coach_update' });
			}
		}

		if (excluded.has(fromKey)) {
			plan.exclusionMoves.push({ fromKey, toKey });
		}
	}

	return plan;
}
```

Note `Math.min` in both directions: a `truncated` line clamps *down* to the shorter length even though it keeps `learned`, and an `extended` line's depth is already at or below the common prefix so the `min` leaves it alone. One expression covers both.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/repertoire-reconcile.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/repertoire-reconcile.ts mychess/src/lib/repertoire-reconcile.test.ts
git commit -m "feat(repertoire): prefix-clamped progress carry-forward arithmetic (#118)"
```

---

### Task 7: Impact projection

The coach-facing counts, derived from the same plan the students will get.

**Files:**
- Modify: `mychess/src/lib/repertoire-reconcile.ts`
- Modify: `mychess/src/lib/repertoire-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `mychess/src/lib/repertoire-reconcile.test.ts`:

```ts
import { projectImpact } from './repertoire-reconcile';

describe('projectImpact', () => {
	const diffs: VariationDiff[] = [
		{ kind: 'unchanged', existingKey: 'a', sans: [], commonPlies: 4 },
		{ kind: 'extended', existingKey: 'b', sans: [], commonPlies: 4 },
		{ kind: 'diverged', existingKey: 'c', sans: [], commonPlies: 2 },
		{ kind: 'new', existingKey: null, sans: [], commonPlies: 3 },
		{ kind: 'removed', existingKey: 'd', sans: null, commonPlies: 0 }
	];

	it('counts each diff class', () => {
		const impact = projectImpact(diffs, []);
		expect(impact.counts).toEqual({
			unchanged: 1, extended: 1, truncated: 0, diverged: 1, new: 1, removed: 1
		});
	});

	it('counts only students who actually lose a learned line', () => {
		const impact = projectImpact(diffs, [
			// Learned both changed lines — loses 2.
			{ playerId: 'p1', solved: ['b', 'c'] },
			// Learned only the unchanged line — loses nothing.
			{ playerId: 'p2', solved: ['a'] },
			// Learned one changed line — loses 1.
			{ playerId: 'p3', solved: ['b'] }
		]);
		expect(impact.affectedPlayerCount).toBe(2);
		expect(impact.demotedLineCount).toBe(3);
	});

	it('reports no impact when nobody has learned a changed line', () => {
		const impact = projectImpact(diffs, [{ playerId: 'p1', solved: ['a'] }]);
		expect(impact.affectedPlayerCount).toBe(0);
		expect(impact.demotedLineCount).toBe(0);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/repertoire-reconcile.test.ts -t projectImpact
```

Expected: FAIL — `projectImpact` is not exported.

- [ ] **Step 3: Implement**

Append to `mychess/src/lib/repertoire-reconcile.ts`:

```ts
export type ImpactCounts = Record<'unchanged' | 'extended' | 'truncated' | 'diverged' | 'new' | 'removed', number>;

export type Impact = {
	counts: ImpactCounts;
	/** Learned lines that will drop to review, summed across students. */
	demotedLineCount: number;
	/** Students losing at least one learned line. */
	affectedPlayerCount: number;
};

/**
 * The coach's pre-apply projection. Deliberately derived from the same
 * `KEEPS_LEARNED` rule `planReconciliation` uses, so the number shown to the
 * coach and the change applied to students cannot disagree.
 *
 * A projection, not a fact: reconciliation is lazy, so these rows change on
 * each student's next load. Copy must say "will", not "did".
 */
export function projectImpact(
	diffs: VariationDiff[],
	students: Array<{ playerId: string; solved: string[] }>
): Impact {
	const counts: ImpactCounts = { unchanged: 0, extended: 0, truncated: 0, diverged: 0, new: 0, removed: 0 };
	for (const d of diffs) counts[d.kind]++;

	const demotingKeys = new Set(
		diffs
			.filter((d) => !KEEPS_LEARNED.has(d.kind) && d.kind !== 'new' && d.existingKey)
			.map((d) => d.existingKey as string)
	);

	let demotedLineCount = 0;
	let affectedPlayerCount = 0;
	for (const student of students) {
		const lost = student.solved.filter((k) => demotingKeys.has(k)).length;
		demotedLineCount += lost;
		if (lost > 0) affectedPlayerCount++;
	}

	return { counts, demotedLineCount, affectedPlayerCount };
}
```

Note `d.kind !== 'removed'` is *not* excluded: a removed line's learned status is kept on the row but the line is no longer drillable, so it counts as lost from the coach's point of view. The test's `d` key is not in any student's `solved`, so this is unasserted — leave the behaviour as written and revisit if the UI needs removed lines counted separately.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/repertoire-reconcile.test.ts && npm run check && npm run lint
```

Expected: 11 passed in that file, clean `check` and `lint`.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/repertoire-reconcile.ts mychess/src/lib/repertoire-reconcile.test.ts
git commit -m "feat(repertoire): project per-student impact of a repertoire update (#118)"
```

---

### Task 8: Reconciliation ordering guard

The one behavioural collision with existing code, pinned before the code that depends on it exists.

**Files:**
- Modify: `mychess/src/lib/repertoire-reconcile.test.ts`

- [ ] **Step 1: Write the test that documents the ordering contract**

Append to `mychess/src/lib/repertoire-reconcile.test.ts`:

```ts
describe('exclusion carry-forward vs reverifyExclusions', () => {
	// `reverifyExclusions` (src/lib/server/repertoire-progress.ts) DELETES any
	// exclusion row whose key is not in the live variation set. Reconciliation
	// must therefore run FIRST and rewrite the key, so the prune sees a live
	// key and leaves the row alone. This test pins the property that makes
	// that ordering correct: every carried-forward exclusion lands on a key
	// that IS in the post-update live set.
	it('rewrites exclusions onto keys present in the post-update live set', () => {
		const OLD = 'm0>m1';
		const NEW = 'm0>m1>m2';
		const diffs: VariationDiff[] = [{ kind: 'extended', existingKey: OLD, sans: [], commonPlies: 2 }];
		const liveKeysAfterUpdate = new Set([NEW]);

		const plan = planReconciliation(diffs, new Map([[OLD, NEW]]), {
			teaching: [],
			solved: [],
			excluded: [OLD],
			activeVariationKey: null
		});

		expect(plan.exclusionMoves).toHaveLength(1);
		for (const move of plan.exclusionMoves) {
			expect(liveKeysAfterUpdate.has(move.toKey)).toBe(true);
			expect(liveKeysAfterUpdate.has(move.fromKey)).toBe(false);
		}
	});
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/lib/repertoire-reconcile.test.ts -t "reverifyExclusions"
```

Expected: PASS — Task 6's implementation already satisfies it. The test exists to fail loudly if someone later "simplifies" `exclusionMoves` into a delete.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/repertoire-reconcile.test.ts
git commit -m "test(repertoire): pin exclusion carry-forward against the stale-key prune (#118)"
```

---

### Task 9: The apply migration

**Files:**
- Modify: `mychess/supabase/migrations/0062_repertoire_update.sql`

- [ ] **Step 1: Append the reconciliation table and widened constraint**

Append to `mychess/supabase/migrations/0062_repertoire_update.sql`:

```sql
-- Per-player reconciliation stamp. Not a column on `assigned_repertoires`:
-- that table only has a row for ASSIGNED repertoires, and a coach practicing
-- their own material has none.
--
-- 'epoch' as the default is migration 0055's asymmetry trick, reused
-- deliberately — nothing is assumed reconciled at deploy time, so every
-- player's first load per repertoire reconciles once, exactly as if the shape
-- had just changed. The freshness test is `reconciled_at >= moves_updated_at`,
-- and reconciliation stamps the repertoire's own `moves_updated_at` value
-- rather than a clock reading, which is what keeps it free of clock skew.
create table if not exists public.repertoire_reconciliation (
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  reconciled_at timestamptz not null default 'epoch',
  primary key (player_id, repertoire_id)
);

alter table public.repertoire_reconciliation enable row level security;

-- Single-operation policies, never a broad `for all`: Postgres ORs together
-- multiple permissive policies for the same operation, so a blanket policy
-- silently defeats any narrower one added beside it later.
drop policy if exists repertoire_reconciliation_select_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_select_own on public.repertoire_reconciliation
  for select using (auth.uid() = player_id);

drop policy if exists repertoire_reconciliation_insert_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_insert_own on public.repertoire_reconciliation
  for insert with check (auth.uid() = player_id);

drop policy if exists repertoire_reconciliation_update_own on public.repertoire_reconciliation;
create policy repertoire_reconciliation_update_own on public.repertoire_reconciliation
  for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

revoke all on public.repertoire_reconciliation from anon, public;
grant select, insert, update on public.repertoire_reconciliation to authenticated;

-- A coach revising a line demotes the learned status of every student who had
-- learned it. That is a demotion like any other and belongs in the same audit
-- trail (0057), but it is not a mistake or a hint.
alter table public.variation_demotions
  drop constraint if exists variation_demotions_cause_check;

alter table public.variation_demotions
  add constraint variation_demotions_cause_check
  check (cause in ('mistake', 'hint', 'coach_update'));
```

- [ ] **Step 2: Append the apply function**

Append to the same file:

```sql
-- The whole update as ONE transaction. Prune is the first genuinely
-- destructive write in this codebase's import path, running against material
-- students are mid-session on; `writeMoves`' own rollback only deletes
-- repertoires the call itself created, which is no help when updating an
-- existing one. A function keeps the retire, the chapter rewrite and the
-- shape recompute atomic with the move upsert.
--
-- `p_expected_moves_updated_at` is optimistic concurrency: the diff the coach
-- reviewed was computed against a specific shape, and applying it against a
-- shape someone else has since changed would apply a stale diff.
--
-- security definer because a coach updates a repertoire they may not own
-- (`repertoires.player_id` can be the student's), so the caller's own RLS is
-- not sufficient — hence the explicit authorization check as the first thing
-- the body does. search_path pinned per Supabase's linter guidance.
create or replace function public.apply_repertoire_update(
  p_repertoire_id uuid,
  p_retire_move_ids uuid[],
  p_chapter_renames jsonb,
  p_expected_moves_updated_at timestamptz,
  p_total_variations int,
  p_has_chapters boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual timestamptz;
  v_owner uuid;
  v_rename jsonb;
begin
  select moves_updated_at, player_id into v_actual, v_owner
    from public.repertoires where id = p_repertoire_id
    for update;

  if v_actual is null then
    raise exception 'Repertoire % not found', p_repertoire_id;
  end if;

  -- Authorized if the caller owns the repertoire, or is an active coach of
  -- the player who does.
  if v_owner <> auth.uid() and not exists (
    select 1 from public.coach_players cp
    where cp.player_id = v_owner and cp.coach_id = auth.uid() and cp.status = 'active'
  ) then
    raise exception 'Not authorized to update repertoire %', p_repertoire_id;
  end if;

  if v_actual <> p_expected_moves_updated_at then
    raise exception 'stale_diff';
  end if;

  -- Rename a chapter in place, which is what preserves the move rows and
  -- therefore every student's progress under them. Replaces rather than
  -- merges: a merge is correct for a multi-chapter FIRST import (transposing
  -- chapters must each see a shared edge) but wrong here, where the old name
  -- is meant to stop existing.
  for v_rename in select * from jsonb_array_elements(p_chapter_renames) loop
    update public.moves
      set chapter_names = array_replace(
            chapter_names,
            v_rename->>'from',
            v_rename->>'to'
          )
      where repertoire_id = p_repertoire_id
        and chapter_names @> array[v_rename->>'from'];
  end loop;

  if array_length(p_retire_move_ids, 1) > 0 then
    update public.moves
      set retired_at = now()
      where repertoire_id = p_repertoire_id
        and id = any(p_retire_move_ids)
        and retired_at is null;
  end if;

  update public.repertoires
    set total_variations = p_total_variations,
        has_chapters = p_has_chapters
    where id = p_repertoire_id;
end $$;

revoke all on function public.apply_repertoire_update(uuid, uuid[], jsonb, timestamptz, int, boolean) from anon, public;
grant execute on function public.apply_repertoire_update(uuid, uuid[], jsonb, timestamptz, int, boolean) to authenticated;
```

The move *upsert* deliberately stays in application code (`writeMoves` already chunks it correctly and handles the position lookup); this function owns only the parts that must be atomic with each other and cannot be expressed as an upsert. The server wrapper in Task 10 calls `writeMoves` first, then this.

- [ ] **Step 3: Hand the migration to the user and wait**

Print the whole file. Ask the user to run it in the Supabase dashboard SQL editor and confirm. Do not proceed to Task 10 without confirmation — every step there calls into this function.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0062_repertoire_update.sql
git commit -m "feat(repertoire): migration for retire, reconciliation stamp and atomic apply (#118)"
```

---

### Task 10: Server orchestration for the diff

**Files:**
- Create: `mychess/src/lib/server/repertoire-update.ts`

Per the codebase's convention, `src/lib/server/` modules are not unit-tested directly — they are thin I/O wrappers over the pure logic already covered in Tasks 3–7, verified manually. Keep the logic in this file trivial for exactly that reason: anything with a decision in it belongs in `repertoire-diff.ts`.

- [ ] **Step 1: Write the module**

Create `mychess/src/lib/server/repertoire-update.ts`:

```ts
// mychess/src/lib/server/repertoire-update.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, hasChapterTags, moveIdsInVariationKey } from '$lib/mastery/variations';
import { classifyVariations, detectRenames, type ExistingLine, type IncomingLine, type VariationDiff } from '$lib/repertoire-diff';
import { projectImpact, type Impact } from '$lib/repertoire-reconcile';
import { fetchAllMoves, toRawMoveRows } from './practice-repertoire';

export type UpdatePreview = {
	diffs: VariationDiff[];
	renames: Array<{ from: string; to: string; overlap: number }>;
	impact: Impact;
	/** Chapters in the repertoire that the upload does not mention. */
	absentChapters: string[];
	/** The shape the diff was computed against — passed back on apply. */
	movesUpdatedAt: string;
};

/**
 * Everything the coach's review screen needs, computed without writing
 * anything. All decisions live in the pure modules; this only gathers input.
 */
export async function buildUpdatePreview(
	supabase: SupabaseClient,
	repertoireId: string,
	incoming: IncomingLine[]
): Promise<UpdatePreview> {
	const { data: rep, error: repErr } = await supabase
		.from('repertoires')
		.select('moves_updated_at')
		.eq('id', repertoireId)
		.single();
	if (repErr) throw new Error(`Failed to load repertoire: ${repErr.message}`);

	const rawMoves = toRawMoveRows(await fetchAllMoves(supabase, repertoireId));
	const variations = enumerateVariations(rawMoves);

	const existing: ExistingLine[] = variations.map((v) => ({
		variationKey: v.variationKey,
		sans: v.path.map((s) => s.san),
		chapterNames: v.chapterNames
	}));

	const diffs = classifyVariations(existing, incoming);

	const existingChapters = new Set(existing.flatMap((e) => e.chapterNames));
	const incomingChapters = new Set(incoming.flatMap((i) => i.chapterNames));
	const absentChapters = [...existingChapters].filter((c) => !incomingChapters.has(c));
	const addedChapters = [...incomingChapters].filter((c) => !existingChapters.has(c));

	const linesByChapter = (lines: Array<{ sans: string[]; chapterNames: string[] }>, name: string) =>
		lines.filter((l) => l.chapterNames.includes(name)).map((l) => l.sans);

	const renames = detectRenames(
		absentChapters.map((name) => ({ name, lines: linesByChapter(existing, name) })),
		addedChapters.map((name) => ({ name, lines: linesByChapter(incoming, name) }))
	);

	// Every student assigned this repertoire, with the lines they have learned.
	const { data: assignments } = await supabase
		.from('assigned_repertoires')
		.select('player_id')
		.eq('repertoire_id', repertoireId);
	const { data: solvedRows } = await supabase
		.from('variation_solved')
		.select('player_id, variation_key')
		.eq('repertoire_id', repertoireId);

	const solvedByPlayer = new Map<string, string[]>();
	for (const row of solvedRows ?? []) {
		const list = solvedByPlayer.get(row.player_id) ?? [];
		list.push(row.variation_key);
		solvedByPlayer.set(row.player_id, list);
	}

	const students = (assignments ?? []).map((a) => ({
		playerId: a.player_id,
		solved: solvedByPlayer.get(a.player_id) ?? []
	}));

	return {
		diffs,
		renames,
		impact: projectImpact(diffs, students),
		absentChapters,
		movesUpdatedAt: rep.moves_updated_at
	};
}

/**
 * The move ids to retire: every ply belonging exclusively to a `removed` line.
 * A ply shared with any surviving line must NOT be retired — retiring a shared
 * prefix move would silently break every line through it.
 */
export function moveIdsToRetire(diffs: VariationDiff[]): string[] {
	const survivingIds = new Set<string>();
	for (const d of diffs) {
		if (d.kind === 'removed' || !d.existingKey) continue;
		for (const id of moveIdsInVariationKey(d.existingKey)) survivingIds.add(id);
	}

	const doomed = new Set<string>();
	for (const d of diffs) {
		if (d.kind !== 'removed' || !d.existingKey) continue;
		for (const id of moveIdsInVariationKey(d.existingKey)) {
			if (!survivingIds.has(id)) doomed.add(id);
		}
	}
	return [...doomed];
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd mychess && npm run check && npm run lint
```

Expected: zero errors from both.

- [ ] **Step 3: Test `moveIdsToRetire`, which does have a real decision in it**

The shared-prefix rule is genuine logic, not I/O, so it gets a test. Create `mychess/src/lib/server/repertoire-update.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { moveIdsToRetire } from './repertoire-update';
import type { VariationDiff } from '$lib/repertoire-diff';

describe('moveIdsToRetire', () => {
	it('never retires a ply shared with a surviving line', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'removed', existingKey: 'a>b>c>d', sans: null, commonPlies: 0 },
			{ kind: 'unchanged', existingKey: 'a>b>x', sans: [], commonPlies: 3 }
		];
		// a and b are shared with the surviving line; only c and d die.
		expect(moveIdsToRetire(diffs).sort()).toEqual(['c', 'd']);
	});

	it('retires every ply of a line sharing nothing', () => {
		const diffs: VariationDiff[] = [
			{ kind: 'removed', existingKey: 'p>q', sans: null, commonPlies: 0 },
			{ kind: 'unchanged', existingKey: 'a>b', sans: [], commonPlies: 2 }
		];
		expect(moveIdsToRetire(diffs).sort()).toEqual(['p', 'q']);
	});

	it('retires nothing when no line was removed', () => {
		const diffs: VariationDiff[] = [{ kind: 'extended', existingKey: 'a>b', sans: [], commonPlies: 2 }];
		expect(moveIdsToRetire(diffs)).toEqual([]);
	});
});
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/lib/server/repertoire-update.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/repertoire-update.ts mychess/src/lib/server/repertoire-update.test.ts
git commit -m "feat(repertoire): build update preview and resolve moves to retire (#118)"
```

---

### Task 11: Server reconciliation

**Files:**
- Create: `mychess/src/lib/server/repertoire-reconcile.ts`
- Modify: `mychess/src/lib/server/repertoire-progress.ts`

- [ ] **Step 1: Write the reconciliation runner**

Create `mychess/src/lib/server/repertoire-reconcile.ts`:

```ts
// mychess/src/lib/server/repertoire-reconcile.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planReconciliation, type PlayerProgress } from '$lib/repertoire-reconcile';
import type { VariationDiff } from '$lib/repertoire-diff';

/**
 * Brings ONE player's progress rows in line with a repertoire whose shape has
 * moved, then stamps them as reconciled against that shape.
 *
 * Must run BEFORE `reverifyExclusions` on the same load: that function deletes
 * exclusion rows whose key no longer names a live variation, which for a line
 * the coach merely extended would destroy the student's "skip this line"
 * rather than carrying it. See the ordering test in
 * `src/lib/repertoire-reconcile.test.ts`.
 *
 * Best-effort and safe to fail: every write is idempotent, and the stamp is
 * written LAST, so a failure part-way means the next load repeats the work
 * rather than skipping it. Only the caller's own rows are touched, so this
 * needs no privileges beyond each table's existing player-scoped RLS.
 */
export async function reconcilePlayerProgress(
	supabase: SupabaseClient,
	params: {
		playerId: string;
		repertoireId: string;
		diffs: VariationDiff[];
		keyMap: ReadonlyMap<string, string>;
		movesUpdatedAt: string;
	}
): Promise<void> {
	const { playerId, repertoireId, diffs, keyMap, movesUpdatedAt } = params;

	const [teaching, solved, excluded, active] = await Promise.all([
		supabase
			.from('variation_teaching_progress')
			.select('variation_key, taught_plies, mastered_plies, clean_pass_count')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId),
		supabase.from('variation_solved').select('variation_key').eq('player_id', playerId).eq('repertoire_id', repertoireId),
		supabase
			.from('variation_practice_exclusions')
			.select('variation_key')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId),
		supabase
			.from('practice_active_variation')
			.select('active_variation_key')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.maybeSingle()
	]);

	const progress: PlayerProgress = {
		teaching: (teaching.data ?? []).map((r) => ({
			variationKey: r.variation_key,
			taughtPlies: r.taught_plies,
			masteredPlies: r.mastered_plies,
			cleanPassCount: r.clean_pass_count
		})),
		solved: (solved.data ?? []).map((r) => r.variation_key),
		excluded: (excluded.data ?? []).map((r) => r.variation_key),
		activeVariationKey: active.data?.active_variation_key ?? null
	};

	const plan = planReconciliation(diffs, keyMap, progress);

	for (const u of plan.teachingUpdates) {
		const { error } = await supabase
			.from('variation_teaching_progress')
			.update({
				variation_key: u.toKey,
				taught_plies: u.taughtPlies,
				mastered_plies: u.masteredPlies,
				clean_pass_count: u.cleanPassCount,
				last_clean_pass_at: u.cleanPassCount === 0 ? null : undefined
			})
			.eq('player_id', playerId)
			.eq('variation_key', u.fromKey);
		if (error) return console.error('Failed to carry teaching progress forward:', error);
	}

	for (const i of plan.teachingInserts) {
		const { error } = await supabase.from('variation_teaching_progress').upsert(
			{
				player_id: playerId,
				repertoire_id: repertoireId,
				variation_key: i.variationKey,
				taught_plies: i.taughtPlies,
				mastered_plies: i.masteredPlies
			},
			{ onConflict: 'player_id,variation_key_hash' }
		);
		if (error) return console.error('Failed to seed inherited teaching progress:', error);
	}

	for (const m of plan.solvedMoves) {
		const { error } = await supabase
			.from('variation_solved')
			.update({ variation_key: m.toKey })
			.eq('player_id', playerId)
			.eq('variation_key', m.fromKey);
		if (error) return console.error('Failed to carry learned status forward:', error);
	}

	if (plan.solvedDeletes.length > 0) {
		const { error } = await supabase
			.from('variation_solved')
			.delete()
			.eq('player_id', playerId)
			.in('variation_key', plan.solvedDeletes);
		if (error) return console.error('Failed to demote learned lines:', error);
	}

	if (plan.demotions.length > 0) {
		const { error } = await supabase.from('variation_demotions').insert(
			plan.demotions.map((d) => ({
				player_id: playerId,
				repertoire_id: repertoireId,
				variation_key: d.variationKey,
				cause: d.cause
			}))
		);
		if (error) return console.error('Failed to log coach-update demotions:', error);
	}

	for (const m of plan.exclusionMoves) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.update({ variation_key: m.toKey, verified_at: movesUpdatedAt })
			.eq('player_id', playerId)
			.eq('variation_key', m.fromKey);
		if (error) return console.error('Failed to carry exclusion forward:', error);
	}

	if (plan.clearActiveVariation) {
		const { error } = await supabase
			.from('practice_active_variation')
			.update({ active_variation_key: null })
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId);
		if (error) return console.error('Failed to clear active variation:', error);
	}

	// Stamped LAST and with the repertoire's own `moves_updated_at` value, not
	// a clock reading — same reasoning as `reverifyExclusions`' stamp: the test
	// is `reconciled_at >= moves_updated_at`, so stamping the exact value it is
	// compared against satisfies it with no clock agreement needed.
	const { error } = await supabase
		.from('repertoire_reconciliation')
		.upsert(
			{ player_id: playerId, repertoire_id: repertoireId, reconciled_at: movesUpdatedAt },
			{ onConflict: 'player_id,repertoire_id' }
		);
	if (error) console.error('Failed to stamp reconciliation:', error);
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd mychess && npm run check && npm run lint
```

Expected: zero errors. If `variation_key_hash` is rejected as an `onConflict` target, check migration 0049 — the constraint is `variation_teaching_progress_player_id_variation_key_hash_key`, and `onConflict` takes column names, so `'player_id,variation_key_hash'` is correct.

- [ ] **Step 3: Wire it in before `reverifyExclusions`**

Read `mychess/src/lib/server/repertoire-progress.ts:290-320` — the block that calls `reverifyExclusions` when a repertoire's exclusions are behind its `moves_updated_at`. Insert the reconciliation call immediately before it, guarded on the player's own stamp:

```ts
// Reconciliation MUST precede reverifyExclusions: that function deletes
// exclusion rows whose key went stale, and for a line the coach extended
// the carried-forward key is exactly such a row. Reconciliation rewrites
// the key first so the prune sees it as live.
if (rep?.moves_updated_at) {
	const { data: stamp } = await supabase
		.from('repertoire_reconciliation')
		.select('reconciled_at')
		.eq('player_id', userId)
		.eq('repertoire_id', rep.id)
		.maybeSingle();
	if (!stamp || stamp.reconciled_at < rep.moves_updated_at) {
		await reconcileFromLiveShape(supabase, userId, rep.id, rep.moves_updated_at);
	}
	await reverifyExclusions(supabase, userId, rows, liveKeys, rep.moves_updated_at);
}
```

`reconcileFromLiveShape` is a thin helper in `repertoire-reconcile.ts` for the case where no diff was recorded — it reconstructs a keyMap by matching each stale progress key's SAN path against the live variation set, then calls `reconcilePlayerProgress`. Add it:

```ts
/**
 * Reconciliation for a player arriving at a repertoire whose shape moved
 * without a recorded diff — the normal case, since apply is lazy and the diff
 * is not persisted. Rebuilds the old-to-new key mapping from the live shape by
 * longest-common-prefix, which is the same rule `classifyVariations` uses.
 */
export async function reconcileFromLiveShape(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	movesUpdatedAt: string
): Promise<void> {
	const rawMoves = toRawMoveRows(await fetchAllMoves(supabase, repertoireId));
	const live = enumerateVariations(rawMoves);

	const liveLines: ExistingLine[] = live.map((v) => ({
		variationKey: v.variationKey,
		sans: v.path.map((s) => s.san),
		chapterNames: v.chapterNames
	}));

	const { data: teachingRows } = await supabase
		.from('variation_teaching_progress')
		.select('variation_key')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);

	const liveKeys = new Set(liveLines.map((l) => l.variationKey));
	const staleKeys = (teachingRows ?? []).map((r) => r.variation_key).filter((k) => !liveKeys.has(k));
	if (staleKeys.length === 0) return;

	// A stale key's plies are gone from `moves`, so its SAN path is not
	// recoverable from the live tree. Match on the surviving move-id prefix
	// instead: the unchanged head of a modified line keeps its ids.
	const diffs: VariationDiff[] = [];
	const keyMap = new Map<string, string>();
	for (const staleKey of staleKeys) {
		const staleIds = moveIdsInVariationKey(staleKey);
		let best: { key: string; shared: number } | null = null;
		for (const line of liveLines) {
			const liveIds = moveIdsInVariationKey(line.variationKey);
			let shared = 0;
			while (shared < staleIds.length && shared < liveIds.length && staleIds[shared] === liveIds[shared]) shared++;
			if (!best || shared > best.shared) best = { key: line.variationKey, shared };
		}
		if (!best || best.shared === 0) {
			diffs.push({ kind: 'removed', existingKey: staleKey, sans: null, commonPlies: 0 });
			continue;
		}
		keyMap.set(staleKey, best.key);
		const newIds = moveIdsInVariationKey(best.key);
		diffs.push({
			kind: best.shared === staleIds.length ? 'extended' : newIds.length === best.shared ? 'truncated' : 'diverged',
			existingKey: staleKey,
			sans: null,
			commonPlies: best.shared
		});
	}

	await reconcilePlayerProgress(supabase, { playerId, repertoireId, diffs, keyMap, movesUpdatedAt });
}
```

Add the imports this needs at the top of `repertoire-reconcile.ts`:

```ts
import { enumerateVariations, moveIdsInVariationKey } from '$lib/mastery/variations';
import type { ExistingLine } from '$lib/repertoire-diff';
import { fetchAllMoves, toRawMoveRows } from './practice-repertoire';
```

- [ ] **Step 4: Run the full suite**

```bash
npm test && npm run check && npm run lint
```

Expected: all pass. `repertoire-progress.test.ts` constructs fixtures — if it fails on the new `repertoire_reconciliation` query, add the table to its Supabase mock rather than weakening the guard.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/repertoire-reconcile.ts mychess/src/lib/server/repertoire-progress.ts
git commit -m "feat(repertoire): reconcile player progress before the stale-key prune (#118)"
```

---

### Task 12: Coach review route

**Files:**
- Create: `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.server.ts`
- Create: `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/update/+page.svelte`
- Create: `mychess/src/lib/components/RepertoireDiffReview.svelte`

Read `mychess/src/lib/components/PgnImportForm.svelte` before starting — its file input, parse call and chapter extraction are reused, and its visually-hidden-input-plus-styled-label pattern is asserted on by component tests (`getByLabelText`), so keep that structure.

- [ ] **Step 1: Write the loader and apply action**

Create `+page.server.ts`:

```ts
import { error, fail } from '@sveltejs/kit';
import { requireAccount } from '$lib/server/auth';
import { buildUpdatePreview, moveIdsToRetire } from '$lib/server/repertoire-update';
import { writeMoves } from '$lib/server/pgn-import';
import { enumerateVariations, hasChapterTags } from '$lib/mastery/variations';
import { fetchAllMoves, toRawMoveRows } from '$lib/server/practice-repertoire';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { user } = await locals.safeGetSession();
	requireAccount(locals);

	const { data: rep, error: repErr } = await locals.supabase
		.from('repertoires')
		.select('id, name, color, moves_updated_at')
		.eq('id', params.repertoire_id)
		.single();
	if (repErr) throw error(404, 'Repertoire not found');

	const { count } = await locals.supabase
		.from('assigned_repertoires')
		.select('id', { count: 'exact', head: true })
		.eq('repertoire_id', rep.id);

	return { repertoire: rep, assignedStudentCount: count ?? 0, coachId: user!.id };
};

export const actions: Actions = {
	preview: async ({ locals, params, request }) => {
		requireAccount(locals);
		const form = await request.formData();
		const incoming = JSON.parse(String(form.get('incoming')));
		const preview = await buildUpdatePreview(locals.supabase, params.repertoire_id, incoming);
		return { preview };
	},

	apply: async ({ locals, params, request }) => {
		requireAccount(locals);
		const form = await request.formData();
		const moves = JSON.parse(String(form.get('moves')));
		const diffs = JSON.parse(String(form.get('diffs')));
		const renames = JSON.parse(String(form.get('renames')));
		const expectedMovesUpdatedAt = String(form.get('movesUpdatedAt'));

		// Moves first: the upsert is already correct and chunked in writeMoves,
		// and every id the RPC needs to retire must exist before it runs.
		const written = await writeMoves(locals.supabase, {
			playerId: (await locals.safeGetSession()).user!.id,
			name: String(form.get('name')),
			color: String(form.get('color')) as 'white' | 'black',
			ecoCode: null,
			ecoName: null,
			moves,
			existingRepertoireId: params.repertoire_id,
			finalize: false
		});
		if (written.error) return fail(500, { error: written.error });

		const raw = toRawMoveRows(await fetchAllMoves(locals.supabase, params.repertoire_id));
		const variations = enumerateVariations(raw);

		const { error: rpcErr } = await locals.supabase.rpc('apply_repertoire_update', {
			p_repertoire_id: params.repertoire_id,
			p_retire_move_ids: moveIdsToRetire(diffs),
			p_chapter_renames: renames,
			p_expected_moves_updated_at: expectedMovesUpdatedAt,
			p_total_variations: variations.length,
			p_has_chapters: hasChapterTags(variations)
		});
		if (rpcErr) {
			return fail(409, {
				error:
					rpcErr.message === 'stale_diff'
						? 'This repertoire changed since you started. Reload to see the current diff.'
						: rpcErr.message
			});
		}

		return { applied: true };
	}
};
```

**Known wrinkle to resolve while implementing:** `writeMoves` runs before the RPC, so its INSERT bumps `moves_updated_at` via 0055's trigger, and the RPC's `p_expected_moves_updated_at` check then fails against the coach's own write. Fix by reading `moves_updated_at` immediately before `writeMoves` and passing *that* value, and having the RPC compare against the value as of transaction start — or simplest and preferred: move the staleness check to the top of the `apply` action, comparing the repertoire's current `moves_updated_at` against the form's value *before* calling `writeMoves`, and drop the parameter from the RPC. Take the simpler option and update the migration accordingly; the guard's purpose (refuse a diff computed against a shape that has since moved) is served either way.

- [ ] **Step 2: Verify it type-checks**

```bash
cd mychess && npm run check
```

Expected: zero errors.

- [ ] **Step 3: Build the review component**

Create `mychess/src/lib/components/RepertoireDiffReview.svelte`. Structure and copy come from the approved mockup (https://claude.ai/code/artifact/d6454dc1-583a-4cf2-8284-65ad6b46496d): summary chip strip, chapter rail with a state stripe and per-chapter counts, line-by-line diff rendering the change in place (struck old ply beside the new one), then the three decision blocks, then apply.

Requirements the mockup encodes and the component must honour:

- Every default is the non-destructive one: keep absent chapters, accept a rename at or above threshold, notify students.
- Impact copy says **will**, not did — reconciliation is lazy.
- Diff-class colours are semantic and separate from the app's accent. Use existing theme tokens; **no hardcoded `gray-*`** (see `CLAUDE.md` and the token cleanup in the practice overhaul).
- Chip counts use `font-variant-numeric: tabular-nums`.
- The diff line list scrolls horizontally inside its own container; the page body never scrolls sideways.

Props: `preview: UpdatePreview`, `repertoireName: string`, `assignedStudentCount: number`. Emits the coach's decisions (rename accept/reject, absent-chapter keep/remove, notify) upward for the form submission.

- [ ] **Step 4: Build the route page**

Create `+page.svelte`: file input (reusing `PgnImportForm.svelte`'s hidden-input + styled-label pattern) → parse client-side → POST to `?/preview` via `use:enhance` → render `RepertoireDiffReview` → POST to `?/apply`.

- [ ] **Step 5: Add the entry point**

In `mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]/+page.svelte`, add an "Update from file" link to `./update`.

- [ ] **Step 6: Run the suite**

```bash
npm test && npm run check && npm run lint
```

Expected: all pass, zero errors.

- [ ] **Step 7: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/repertoires/[repertoire_id]" mychess/src/lib/components/RepertoireDiffReview.svelte
git commit -m "feat(coach): repertoire update review screen (#118)"
```

---

### Task 13: Student notification

**Files:**
- Create: `mychess/src/lib/components/RepertoireUpdatedBanner.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

- [ ] **Step 1: Surface the count from the loader**

In the practice route's `+page.server.ts`, after the existing load, count this player's `variation_demotions` rows for this repertoire with `cause = 'coach_update'` since their last reconciliation, and return it as `coachUpdatedLineCount`:

```ts
const { count: coachUpdatedLineCount } = await locals.supabase
	.from('variation_demotions')
	.select('id', { count: 'exact', head: true })
	.eq('player_id', user!.id)
	.eq('repertoire_id', params.repertoire_id)
	.eq('cause', 'coach_update');
```

- [ ] **Step 2: Build the banner**

Create `mychess/src/lib/components/RepertoireUpdatedBanner.svelte`. One prop, `lineCount: number`. Renders nothing when zero. Copy: **"Your coach updated this repertoire — {lineCount} lines need review."** Singular form for one line. Dismissible. Theme tokens only, no hardcoded `gray-*`.

- [ ] **Step 3: Render it above the board**

Place it in the practice page above the status strip, so it does not shift the board — the status slot's height is pinned deliberately (see the fix in commit `2fa68dd`), and the banner must sit outside that slot rather than inside it.

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run check && npm run lint
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/RepertoireUpdatedBanner.svelte "mychess/src/routes/(player)/practice/[repertoire_id]"
git commit -m "feat(practice): tell students when their coach updated a repertoire (#118)"
```

---

### Task 14: End-to-end verification and close-out

**Files:**
- Create: `mychess/tests/repertoire-update.e2e.ts`

- [ ] **Step 1: Write the e2e test**

Create `mychess/tests/repertoire-update.e2e.ts` following the existing `tests/*.e2e.ts` patterns: coach signs in, opens an assigned repertoire, uploads a revised PGN, sees the review with non-zero counts, applies; then a student session loads the repertoire and sees the banner.

- [ ] **Step 2: Run it**

```bash
cd mychess && npx playwright test tests/repertoire-update.e2e.ts
```

Expected: pass on both the Chromium and Pixel 5 profiles.

- [ ] **Step 3: Manual production verification**

The RPC and reconciliation are not unit-tested, per the `src/lib/server/` convention, so they get a real pass. Ask the user to run these with the `!` prefix (Bash cannot read `.env`). On a throwaway repertoire:

1. Apply an update that extends one line, diverges one, removes one, adds one.
2. Confirm unchanged lines' `variation_teaching_progress` rows are byte-identical before and after.
3. Confirm the diverged line's `mastered_plies` clamped to the common prefix.
4. Confirm `variation_demotions` gained rows with `cause = 'coach_update'`.
5. Confirm the removed line's moves have `retired_at` set and no longer appear in the practice pool, while its progress rows still exist.
6. Confirm a stale-diff apply is refused rather than applied.

- [ ] **Step 4: Delete the throwaway data**

Per `CLAUDE.md`, remove any QA account or repertoire created for this verification — narrowly, only what this task created — and say what was deleted.

- [ ] **Step 5: Refactor pass**

Per `CLAUDE.md`'s post-feature rule, review the feature's own files plus what it touched: logic copy-pasted rather than extracted (the `ExistingLine` mapping appears in both `repertoire-update.ts` and `repertoire-reconcile.ts` — extract it), dead code, drift from the pure-logic/I-O split, files that grew unwieldy. Fix what is cheap; file an issue for anything bigger.

- [ ] **Step 6: Push and close**

```bash
cd mychess && npm test && npm run check && npm run lint
git push origin main
gh issue close 118 --comment "Shipped. Migration 0062 applied; verified in production against a throwaway repertoire."
```

Do not close #118 until the user has confirmed migration 0062 is applied in production — the feature is inert without it.

---

## Self-review

**Spec coverage.** Every numbered goal maps to a task: (1) Task 12; (2) Tasks 3–4, 7; (3) Task 7; (4) Task 6, `unchanged` case; (5) Task 6; (6) Task 6 plus the widened constraint in Task 9; (7) Task 12's decision block; (8) Task 5 plus the rename branch of the RPC in Task 9; (9) Tasks 1–2 and 9's retire, with the keep-rows assertion in Task 6; (10) Task 9; (11) Task 13. Error handling: stale diff (Task 9/12), reconcile failure best-effort (Task 11), ambiguous rename (Task 5).

**Two gaps I am flagging rather than papering over:**

1. **Task 12 Step 1 contains a real unresolved interaction**, not a placeholder: `writeMoves` bumps `moves_updated_at` before the RPC checks it, so the concurrency guard as specified in Task 9 would reject the coach's own write. The step names both fixes and picks one (check in the action, before `writeMoves`; drop the RPC parameter), and says to update the migration accordingly. Whoever implements Task 12 must apply that back to Task 9's SQL.
2. **Tasks 12 and 13 specify UI structure and copy rather than complete Svelte source.** The mockup is the authority for layout and wording, and reproducing several hundred lines of markup here would duplicate it. Every non-obvious constraint that markup must satisfy is listed explicitly (defaults, "will" not "did", token usage, tabular numerals, horizontal scroll containment, banner outside the pinned status slot).

**Type consistency.** `VariationDiff` / `ExistingLine` / `IncomingLine` / `DiffKind` are defined once in Task 3 and used unchanged in 4, 6, 7, 10, 11. `PlayerProgress` and `ReconciliationPlan` are defined in Task 6 and consumed in 11. `commonPlies` means plies, everywhere. `RENAME_THRESHOLD` is referenced only where defined. The RPC signature in Task 9 matches the `rpc()` call in Task 12 except for the parameter Task 12 explicitly removes.
