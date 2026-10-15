# Per-Chapter Variation Enumeration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `enumerateVariations` so a chaptered repertoire's total variation count is the sum of each chapter's own variations, never a product across chapters that transpose into shared positions — the root cause of a real out-of-memory crash on a 414-chapter PGN import.

**Architecture:** Every move (not just chapter-ending leaves) gets tagged with the full set of chapters that use it (`moves.chapter_names text[]`, replacing the leaf-only `moves.chapter_name text`). `enumerateVariations` becomes a dispatcher: for each distinct chapter name found across the moves, it walks that chapter's own edge-subset independently (the existing tree-walk algorithm, unchanged, just scoped), then concatenates the results — so cross-chapter reconvergence can never multiply the path count, only within-chapter branching can (which is legitimate and already expected).

**Tech Stack:** SvelteKit 2, Supabase (Postgres), vitest.

**Design doc:** `docs/superpowers/specs/2026-08-15-per-chapter-variation-enumeration-design.md`

---

### Task 1: Migration — add `moves.chapter_names`

**Files:**
- Create: `mychess/supabase/migrations/0048_move_chapter_names_array.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0048_move_chapter_names_array.sql`:

```sql
-- mychess/supabase/migrations/0048_move_chapter_names_array.sql
-- Replaces chapter_name (leaf-only, migration 0042) with an array recording
-- EVERY chapter that uses a given move edge, not just the one that closes
-- out a line. A shared prefix move used by many transposing chapters needs
-- to know all of them — enumerateVariations scopes its walk per chapter
-- using this, so cross-chapter transposition can no longer multiply the
-- enumerated path count the way a single whole-repertoire walk did (see the
-- 2026-08-15 design doc — a real 414-chapter PGN import OOM'd the server
-- from exactly this). No backfill: chapter_name never recorded interior-move
-- membership, so there's nothing to derive chapter_names from for
-- already-imported repertoires — they keep working as before unless they're
-- already broken by this bug, in which case they need re-uploading. The old
-- chapter_name column is dropped in a follow-up migration once this one's
-- confirmed working (see 0049).
alter table public.moves add column chapter_names text[] not null default '{}';
```

- [ ] **Step 2: Present the migration to the user to run**

Paste the migration's contents for the user to run manually in the Supabase dashboard SQL editor, per this project's convention (no local Postgres, no working service-role key in this environment).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add supabase/migrations/0048_move_chapter_names_array.sql
git commit -m "feat: add moves.chapter_names for per-chapter variation scoping"
```

- [ ] **Step 4: STOP — do not proceed to Task 3, 4, or 5 until the user confirms Step 2's migration has actually been run in the production Supabase database.**

Task 2 (`variations.ts`) is pure logic with no database dependency — safe to do next regardless. But Tasks 3, 4, and 5 change code to `select`/`upsert` the new `chapter_names` column. If that code reaches `main` (which auto-deploys via Vercel per this project's convention) before the column exists in production, every repertoire load, practice session, and import would start erroring — a much broader outage than a normal missing-migration gap, since this column is read on nearly every repertoire touchpoint. Do Task 2, then explicitly ask the user to confirm the migration has been applied before starting Task 3. This is a genuine external dependency the plan cannot resolve on its own — treat it as a BLOCKED condition, not something to push through.

---

### Task 2: `variations.ts` — per-chapter scoped enumeration

**Files:**
- Modify: `mychess/src/lib/mastery/variations.ts`
- Modify: `mychess/src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Replace the test file's `move()` helper and every existing test to use `chapterNames`**

Replace the whole contents of `mychess/src/lib/mastery/variations.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
	enumerateVariations,
	filterVariations,
	groupByFirstMoves,
	hasChapterTags,
	moveSequenceLabel,
	type RawMoveRow,
	type Variation,
	type VariationStep
} from './variations';

function move(
	id: string,
	fromPositionId: string,
	toPositionId: string,
	san: string,
	isPlayerTurn: boolean,
	chapterNames: string[] = []
): RawMoveRow {
	return {
		id,
		fromPositionId,
		toPositionId,
		fromFen: `fen:${fromPositionId}`,
		toFen: `fen:${toPositionId}`,
		san,
		isPlayerTurn,
		chapterNames
	};
}

describe('enumerateVariations', () => {
	it('returns a single variation for a linear repertoire', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].leafMoveId).toBe('m3');
		expect(result[0].path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
		expect(result[0].playerMoveCount).toBe(2);
	});

	it('splits into two variations when the opponent has two replies', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		const leafIds = result.map((v) => v.leafMoveId).sort();
		expect(leafIds).toEqual(['m3a', 'm3b']);
		for (const v of result) {
			expect(v.playerMoveCount).toBe(2);
			expect(v.path[0].moveId).toBe('m1'); // shared prefix
		}
	});

	it('splits into two variations when the player has two prepared responses at the same node', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3a', 'P2', 'P3A', 'Nf3', true),
			move('m3b', 'P2', 'P3B', 'Bc4', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m3a', 'm3b']);
	});

	it('handles multiple independent roots in the same repertoire', () => {
		const moves = [
			move('m1', 'START_A', 'P1', 'e4', true),
			move('m2', 'START_B', 'P2', 'd4', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m1', 'm2']);
	});

	it('counts only is_player_turn steps toward playerMoveCount', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true),
			move('m4', 'P3', 'P4', 'Nc6', false),
			move('m5', 'P4', 'P5', 'Bb5', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].playerMoveCount).toBe(3);
		expect(result[0].path).toHaveLength(5);
	});

	it('returns an empty array for no moves', () => {
		expect(enumerateVariations([])).toEqual([]);
	});

	it('gives two variations the same leafMoveId but different variationKeys when they transpose into a shared tail (no chapters involved)', () => {
		// Two different prefixes (m1a vs m1b) both lead into the same shared node P_SHARED,
		// which then has one single continuation to a shared leaf (m3) — a transposition
		// within a single (un-chaptered) scope, which is legitimate and NOT the bug this
		// feature fixes — see the cross-chapter tests below for that.
		const moves = [
			move('m1a', 'START_A', 'P_SHARED', 'e4', true),
			move('m1b', 'START_B', 'P_SHARED', 'd4', true),
			move('m2', 'P_SHARED', 'P2', 'Nf3', false),
			move('m3', 'P2', 'P3', 'Bb5', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result[0].leafMoveId).toBe('m3');
		expect(result[1].leafMoveId).toBe('m3');
		expect(result[0].variationKey).not.toBe(result[1].variationKey);
	});

	it('carries the chapter name onto every variation walked under that chapter\'s own scope', () => {
		// Every move on the line — not just the leaf — must carry the chapter's
		// name, or the scoped walk can't reconstruct the full path (an interior
		// move with no chapter tag is invisible to every chapter's own walk).
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['Ruy Lopez']),
			move('m2', 'P1', 'P2', 'e5', false, ['Ruy Lopez']),
			move('m3', 'P2', 'P3', 'Nf3', true, ['Ruy Lopez'])
		];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBe('Ruy Lopez');
		expect(variation.path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
	});

	it('defaults chapterName to null for moves with no chapter tags at all', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBeNull();
	});

	it('sums each chapter\'s own variations instead of multiplying when chapters share a prefix then diverge', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']), // shared prefix, used by both chapters
			move('m2a', 'P1', 'P2A', 'Nf3', false, ['A']), // A's own continuation
			move('m2b', 'P1', 'P2B', 'Nc3', false, ['B']) // B's own continuation
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2); // one per chapter
		expect(result.map((v) => v.chapterName).sort()).toEqual(['A', 'B']);
	});

	it('does not multiply a shared continuation across chapters that transpose into it from different openings', () => {
		const moves = [
			// Chapter A reaches the shared node via its own opening move.
			move('a1', 'START_A', 'SHARED', 'e4', true, ['A']),
			// Chapter B reaches the SAME shared node via a different opening move — a transposition.
			move('b1', 'START_B', 'SHARED', 'd4', true, ['B']),
			// From the shared node, two further branches — chapter A's own game explores
			// both; chapter B's own game only explores the first.
			move('c1', 'SHARED', 'C1', 'Nf3', false, ['A', 'B']),
			move('c2', 'SHARED', 'C2', 'Bc4', false, ['A'])
		];
		const result = enumerateVariations(moves);
		// A contributes 2 (a1->c1, a1->c2). B contributes 1 (b1->c1). Total 3 — NOT 2*2=4.
		expect(result).toHaveLength(3);
		expect(result.filter((v) => v.chapterName === 'A')).toHaveLength(2);
		expect(result.filter((v) => v.chapterName === 'B')).toHaveLength(1);
	});

	it('enumerates a fully-shared line once per chapter, not deduplicated away', () => {
		// Two chapters whose entire line is textually identical — matches how a
		// real opening reference cross-references one tabiya under two headings.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']),
			move('m2', 'P1', 'P2', 'e5', false, ['A', 'B'])
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId)).toEqual(['m2', 'm2']);
		expect(result.map((v) => v.chapterName).sort()).toEqual(['A', 'B']);
		// Same underlying path, but each chapter's own enumeration is independent.
		expect(result[0].variationKey).toBe(result[1].variationKey);
	});

	it('stays additive (not exponential) when many chapters repeatedly transpose through the same shared checkpoints', () => {
		// Reproduces the shape that crashed the server on a real 414-chapter PGN
		// import (see the design doc): chapters repeatedly transpose into and
		// back out of a shared sequence of positions. A walk that doesn't
		// distinguish chapters re-explores every downstream path once per
		// incoming way of reaching each shared checkpoint — doubling at every
		// checkpoint here, so 12 checkpoints would enumerate 2^13 (8192) paths
		// instead of the correct 2 (one per chapter). This is the actual
		// regression test for the bug.
		const CHAPTERS = ['A', 'B'];
		const CHECKPOINTS = 12;
		const moves: RawMoveRow[] = [];
		const prevByChapter: Record<string, string> = { A: 'ROOT', B: 'ROOT' };
		for (let d = 0; d < CHECKPOINTS; d++) {
			for (const chapter of CHAPTERS) {
				const to = `checkpoint-${d}`;
				moves.push(move(`m-${chapter}-${d}`, prevByChapter[chapter], to, `move-${d}`, d % 2 === 0, [chapter]));
				prevByChapter[chapter] = to;
			}
		}
		for (const chapter of CHAPTERS) {
			moves.push(move(`leaf-${chapter}`, prevByChapter[chapter], `final-${chapter}`, 'final', true, [chapter]));
		}

		const start = Date.now();
		const result = enumerateVariations(moves);
		expect(Date.now() - start).toBeLessThan(2000);
		expect(result).toHaveLength(2); // one variation per chapter, not 2^13
	});
});

describe('hasChapterTags', () => {
	it('returns false when no variation has a chapterName', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(false);
	});

	it('returns true when at least one variation has a chapterName', () => {
		// Every move on the Sicilian branch's own line carries the tag — not
		// just its leaf — matching the new per-move (not per-leaf) invariant.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false, ['Sicilian']),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true, ['Sicilian'])
		];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(true);
	});

	it('returns false for an empty variation list', () => {
		expect(hasChapterTags([])).toBe(false);
	});
});

describe('filterVariations', () => {
	it('returns everything unchanged when the excluded set is empty', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const variations = enumerateVariations(moves);
		expect(filterVariations(variations, new Set())).toEqual(variations);
	});

	it('drops variations whose variationKey is in the excluded set', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true)
		];
		const variations = enumerateVariations(moves);
		const [keep, drop] = variations;
		const result = filterVariations(variations, new Set([drop.variationKey]));
		expect(result).toEqual([keep]);
	});
});

describe('moveSequenceLabel', () => {
	it('numbers full moves starting at 1, White unlabeled-space, Black no number', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true),
			move('m4', 'P3', 'P4', 'Nc6', false),
			move('m5', 'P4', 'P5', 'Bb5', true)
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.e4 e5 2.Nf3 Nc6 3.Bb5');
	});

	it('handles a single-move path', () => {
		const moves = [move('m1', 'START', 'P1', 'd4', true)];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.d4');
	});

	it('ends on Black to move without a trailing extra number', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', toFen: 'x', san: 'e4', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'e5', isPlayerTurn: false, chapterNames: [] },
			{ id: 'm3', fromPositionId: 'P2', toPositionId: 'P3', fromFen: 'y', toFen: 'z', san: 'Nf3', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm4', fromPositionId: 'P3', toPositionId: 'P4', fromFen: 'z', toFen: 'w', san: 'Nc6', isPlayerTurn: false, chapterNames: [] }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.e4 e5 2.Nf3 Nc6');
	});

	it('starts from a custom mid-game FEN where Black is to move first', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 5', toFen: 'x', san: 'Nf6', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'Bc4', isPlayerTurn: false, chapterNames: [] }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('5...Nf6 6.Bc4');
	});
});

describe('groupByFirstMoves', () => {
	function step(san: string, moveId: string): VariationStep {
		return { moveId, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true };
	}
	function item(id: string, sans: string[]): { id: string; path: VariationStep[] } {
		return { id, path: sans.map((san, i) => step(san, `${id}-${i}`)) };
	}
	function stepsOf(x: { path: VariationStep[] }): VariationStep[] {
		return x.path;
	}
	function labels(groups: ReturnType<typeof groupByFirstMoves>) {
		return groups.map((g) => g.steps.map((s) => s.san));
	}
	function ids(group: ReturnType<typeof groupByFirstMoves>[number]) {
		return group.items.map((v: any) => v.id);
	}

	it('buckets items that share the same first-N-plies key together, distinct keys apart', () => {
		const items = [
			item('a', ['e4', 'e5', 'Nf3']),
			item('b', ['e4', 'e5', 'Nf3']),
			item('c', ['d4', 'd5', 'c4'])
		];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5);
		expect(labels(groups)).toEqual([
			['e4', 'e5', 'Nf3'],
			['d4', 'd5', 'c4']
		]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
		expect(ids(groups[1])).toEqual(['c']);
	});

	it('splits items into different buckets if they diverge on the LAST ply within the window', () => {
		const items = [item('a', ['e4', 'e5', 'Nf3']), item('b', ['e4', 'e5', 'Nc3'])];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5);
		expect(labels(groups)).toEqual([
			['e4', 'e5', 'Nf3'],
			['e4', 'e5', 'Nc3']
		]);
	});

	it('keeps items in the SAME bucket if they only diverge past the window', () => {
		const items = [item('a', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), item('b', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5); // window stops before the Bb5/Bc4 divergence
		expect(groups).toHaveLength(1);
		expect(labels(groups)).toEqual([['e4', 'e5', 'Nf3']]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
	});

	it('uses an item\'s whole line as its key when it is shorter than the window', () => {
		const items = [item('a', ['e4', 'e5']), item('b', ['e4', 'e5', 'Nf3'])];
		const groups = groupByFirstMoves(items, stepsOf, 5, 5);
		// 'a' only has 2 plies, so its key is just those 2 — distinct from
		// 'b's 3-ply key, even though 'a' is a strict prefix of 'b'.
		expect(labels(groups)).toEqual([
			['e4', 'e5'],
			['e4', 'e5', 'Nf3']
		]);
	});

	it('caps at topN buckets, bucketing the rest under "Other" (empty steps)', () => {
		const items = [
			item('a', ['e4']),
			item('b', ['e4']),
			item('c', ['d4']),
			item('d', ['c4']),
			item('e', ['Nf3']),
			item('f', ['g3']),
			item('g', ['b3']) // 7th distinct key — bumped to Other
		];
		const groups = groupByFirstMoves(items, stepsOf, 1, 5);
		expect(groups).toHaveLength(6); // 5 named + Other
		const other = groups[5];
		expect(other.steps).toEqual([]);
		expect(ids(other)).toEqual(['g']);
	});

	it('omits the "Other" group entirely when everything fits in the top N', () => {
		const items = [item('a', ['e4']), item('b', ['d4'])];
		const groups = groupByFirstMoves(items, stepsOf, 1, 5);
		expect(groups.every((g) => g.steps.length > 0)).toBe(true);
	});

	it('breaks ties in frequency by first-appearance order (stable, deterministic)', () => {
		const items = [item('a', ['e4']), item('b', ['d4']), item('c', ['c4'])];
		const groups = groupByFirstMoves(items, stepsOf, 1, 2);
		expect(labels(groups)).toEqual([['e4'], ['d4'], []]);
		expect(ids(groups[2])).toEqual(['c']);
	});

	it('returns an empty array for an empty item list', () => {
		expect(groupByFirstMoves([], stepsOf, 5, 5)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd mychess
npx vitest run src/lib/mastery/variations.test.ts
```

Expected: FAIL — `RawMoveRow`/`Variation` don't have `chapterNames` yet (type errors), and the new sum/transposition/additive tests fail against the old single-walk implementation.

- [ ] **Step 3: Rewrite `variations.ts`'s types and `enumerateVariations`**

In `mychess/src/lib/mastery/variations.ts`, replace:

```ts
export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
	// Optional (not just nullable) so the many pre-existing test fixtures
	// across the codebase that hand-construct these types (e.g.
	// `mastery/practice.test.ts`, `mastery/variationSequence.test.ts`) don't all
	// need updating for a field they have no reason to care about — an
	// omitted `chapterName` is treated identically to an explicit `null`
	// everywhere it's read (see `RepertoirePracticeRow.svelte`'s grouping and
	// the `/variations` endpoint's `?? null` normalization).
	chapterName?: string | null;
};
```

with:

```ts
export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
	// Every chapter that uses this edge — not just the one whose line ends
	// on it. A shared prefix move used by many transposing chapters carries
	// all of them. Optional (not just possibly-empty) so the many
	// pre-existing test fixtures across the codebase that hand-construct
	// these types (e.g. `mastery/practice.test.ts`,
	// `mastery/variationSequence.test.ts`) don't all need updating for a
	// field they have no reason to care about — an omitted `chapterNames` is
	// treated identically to `[]` everywhere it's read.
	chapterNames?: string[];
};
```

Then replace the whole `enumerateVariations` function:

```ts
/**
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const byFrom = new Map<string, RawMoveRow[]>();
	const toPositionIds = new Set<string>();
	for (const m of moves) {
		const list = byFrom.get(m.fromPositionId) ?? [];
		list.push(m);
		byFrom.set(m.fromPositionId, list);
		toPositionIds.add(m.toPositionId);
	}

	const fromPositionIds = new Set(moves.map((m) => m.fromPositionId));
	const roots = Array.from(fromPositionIds).filter((id) => !toPositionIds.has(id));

	const variations: Variation[] = [];

	function walk(positionId: string, path: VariationStep[], playerMoveCount: number) {
		const outgoing = byFrom.get(positionId) ?? [];
		if (outgoing.length === 0) {
			if (path.length > 0) {
				variations.push({
					leafMoveId: path[path.length - 1].moveId,
					variationKey: path.map((s) => s.moveId).join('>'),
					path,
					playerMoveCount,
					chapterName: path[path.length - 1].chapterName
				});
			}
			return;
		}
		for (const move of outgoing) {
			const step: VariationStep = {
				moveId: move.id,
				san: move.san,
				fromFen: move.fromFen,
				toFen: move.toFen,
				isPlayerTurn: move.isPlayerTurn,
				chapterName: move.chapterName
			};
			walk(move.toPositionId, [...path, step], playerMoveCount + (move.isPlayerTurn ? 1 : 0));
		}
	}

	for (const root of roots) {
		walk(root, [], 0);
	}

	return variations;
}
```

with:

```ts
/**
 * Every distinct chapter name appearing in any move's `chapterNames`, in
 * first-appearance order (stable, deterministic — matters for the practice
 * picker's chapter list staying in a consistent order across reloads).
 */
function uniqueChapterNames(moves: RawMoveRow[]): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const m of moves) {
		for (const name of m.chapterNames ?? []) {
			if (!seen.has(name)) {
				seen.add(name);
				names.push(name);
			}
		}
	}
	return names;
}

/**
 * The actual tree-walk, scoped to exactly one chapter's own edges (or, for
 * `chapterName: null`, every move that belongs to no chapter at all — the
 * un-chaptered case). Walking only one chapter's own edges at a time is what
 * keeps cross-chapter transposition from multiplying the enumerated path
 * count: a shared position reached by two different chapters' own openings
 * is only ever explored within ONE chapter's own scoped walk at a time, never
 * both together.
 */
function enumerateVariationsScoped(moves: RawMoveRow[], chapterName: string | null): Variation[] {
	const scoped = moves.filter((m) =>
		chapterName === null ? (m.chapterNames ?? []).length === 0 : (m.chapterNames ?? []).includes(chapterName)
	);

	const byFrom = new Map<string, RawMoveRow[]>();
	const toPositionIds = new Set<string>();
	for (const m of scoped) {
		const list = byFrom.get(m.fromPositionId) ?? [];
		list.push(m);
		byFrom.set(m.fromPositionId, list);
		toPositionIds.add(m.toPositionId);
	}

	const fromPositionIds = new Set(scoped.map((m) => m.fromPositionId));
	const roots = Array.from(fromPositionIds).filter((id) => !toPositionIds.has(id));

	const variations: Variation[] = [];

	function walk(positionId: string, path: VariationStep[], playerMoveCount: number) {
		const outgoing = byFrom.get(positionId) ?? [];
		if (outgoing.length === 0) {
			if (path.length > 0) {
				variations.push({
					leafMoveId: path[path.length - 1].moveId,
					variationKey: path.map((s) => s.moveId).join('>'),
					path,
					playerMoveCount,
					chapterName
				});
			}
			return;
		}
		for (const move of outgoing) {
			const step: VariationStep = {
				moveId: move.id,
				san: move.san,
				fromFen: move.fromFen,
				toFen: move.toFen,
				isPlayerTurn: move.isPlayerTurn,
				chapterName
			};
			walk(move.toPositionId, [...path, step], playerMoveCount + (move.isPlayerTurn ? 1 : 0));
		}
	}

	for (const root of roots) {
		walk(root, [], 0);
	}

	return variations;
}

/**
 * Walks a repertoire's move tree and returns one entry per leaf (a complete
 * root-to-leaf path). A branch — whether the opponent has multiple replies,
 * or the repertoire itself prepares two responses at one node — produces two
 * separate variations sharing the common prefix up to the branch point.
 *
 * Chaptered repertoires are walked ONE CHAPTER AT A TIME (see
 * `enumerateVariationsScoped`) and concatenated, rather than as one
 * whole-repertoire walk — multiple PGN chapters imported into one repertoire
 * share position/move rows wherever they transpose into the same edge, and a
 * single walk across the merged graph re-enumerates every downstream path
 * once per way of reaching a shared position, multiplying the total count at
 * every such reconvergence instead of summing per chapter. Un-chaptered
 * repertoires (no move carries any chapter name) fall through to a single
 * scoped walk with `chapterName: null` — identical to the old unscoped
 * behavior, since there's nothing to separate.
 */
export function enumerateVariations(moves: RawMoveRow[]): Variation[] {
	const chapterNames = uniqueChapterNames(moves);
	if (chapterNames.length === 0) return enumerateVariationsScoped(moves, null);
	return chapterNames.flatMap((name) => enumerateVariationsScoped(moves, name));
}
```

Also update the `VariationStep` and `Variation` type doc comments referencing `chapterName` on `RawMoveRow`/`MoveRow.isChapterEnd` if they still name the old field — check `VariationStep.chapterName`'s and `Variation.chapterName`'s own doc comments (both stay `string | null`, unchanged — only `RawMoveRow`'s field renamed).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd mychess
npx vitest run src/lib/mastery/variations.test.ts
```

Expected: PASS, all tests green (18 tests in the `enumerateVariations`/`hasChapterTags` describe blocks combined, plus the pre-existing `filterVariations`/`moveSequenceLabel`/`groupByFirstMoves` ones).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/variations.ts src/lib/mastery/variations.test.ts
git commit -m "fix: scope enumerateVariations per chapter to stop cross-chapter multiplication"
```

---

### Task 3: `practice-repertoire.ts` — read `chapter_names`

**Files:**
- Modify: `mychess/src/lib/server/practice-repertoire.ts`

- [ ] **Step 1: Update the select columns and row mapping**

Find:

```ts
const MOVE_SELECT_COLUMNS =
  'id, san, is_player_turn, from_position, to_position, chapter_name, from_pos:from_position(fen), to_pos:to_position(fen)';
```

Replace with:

```ts
const MOVE_SELECT_COLUMNS =
  'id, san, is_player_turn, from_position, to_position, chapter_names, from_pos:from_position(fen), to_pos:to_position(fen)';
```

Find, in `toRawMoveRows`:

```ts
export function toRawMoveRows(rows: any[]): RawMoveRow[] {
  return rows.map((m: any) => ({
    id: m.id,
    san: m.san,
    isPlayerTurn: m.is_player_turn,
    fromPositionId: m.from_position,
    toPositionId: m.to_position,
    fromFen: m.from_pos?.fen ?? '',
    toFen: m.to_pos?.fen ?? '',
    chapterName: m.chapter_name ?? null
  }));
}
```

Replace with:

```ts
export function toRawMoveRows(rows: any[]): RawMoveRow[] {
  return rows.map((m: any) => ({
    id: m.id,
    san: m.san,
    isPlayerTurn: m.is_player_turn,
    fromPositionId: m.from_position,
    toPositionId: m.to_position,
    fromFen: m.from_pos?.fen ?? '',
    toFen: m.to_pos?.fen ?? '',
    chapterNames: m.chapter_names ?? []
  }));
}
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -10
```

Expected: 0 errors (17 pre-existing warnings is baseline, plus whatever this repo's current untracked-file baseline is — confirm no NEW errors, not "same count as some earlier session" since other in-flight work may have changed the baseline; the bar is always zero).

- [ ] **Step 3: Run the full test suite**

```bash
cd mychess
npm test 2>&1 | tail -15
```

Expected: all tests pass (this file has no dedicated test — `practice-repertoire.test.ts` exists per the repo listing; run it specifically too: `npx vitest run src/lib/server/practice-repertoire.test.ts` — expect pass, no assertions reference the old column name).

- [ ] **Step 4: Commit**

```bash
cd mychess
git add src/lib/server/practice-repertoire.ts
git commit -m "feat: read moves.chapter_names in practice-repertoire.ts"
```

---

### Task 4: `repertoire-progress.ts` — read `chapter_names`

**Files:**
- Modify: `mychess/src/lib/server/repertoire-progress.ts`

- [ ] **Step 1: Update the select columns and row mapping**

Find:

```ts
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position, chapter_name')
```

Replace with:

```ts
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position, chapter_names')
```

Find:

```ts
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: '',
			chapterName: m.chapter_name ?? null
		});
```

Replace with:

```ts
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: '',
			chapterNames: m.chapter_names ?? []
		});
```

- [ ] **Step 2: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 3: Run the full test suite**

```bash
cd mychess
npm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add src/lib/server/repertoire-progress.ts
git commit -m "feat: read moves.chapter_names in repertoire-progress.ts"
```

---

### Task 5: `server/pgn-import.ts` — write chapter membership on every move

**Files:**
- Modify: `mychess/src/lib/server/pgn-import.ts`

- [ ] **Step 1: Update the eager-shape (single-chapter import) path**

Find:

```ts
      const dedupedMoves = Array.from(new Map(params.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
      const rawMoves: RawMoveRow[] = dedupedMoves.map((m, i) => ({
        id: String(i),
        fromPositionId: m.fromFen,
        toPositionId: m.toFen,
        fromFen: m.fromFen,
        toFen: m.toFen,
        san: m.san,
        isPlayerTurn: m.is_player_turn,
        chapterName: null
      }));
```

Replace with:

```ts
      const dedupedMoves = Array.from(new Map(params.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
      const rawMoves: RawMoveRow[] = dedupedMoves.map((m, i) => ({
        id: String(i),
        fromPositionId: m.fromFen,
        toPositionId: m.toFen,
        fromFen: m.fromFen,
        toFen: m.toFen,
        san: m.san,
        isPlayerTurn: m.is_player_turn,
        chapterNames: []
      }));
```

(This path is single-chapter/`importGames`-only, per its own existing comment two lines below — it never has real chapter tags to check, so an empty array is the correct equivalent of the old hardcoded `null`.)

- [ ] **Step 2: Tag every move with its chapter, not just leaves — and merge on conflict instead of dropping**

Find:

```ts
  // Multiple chapters can share an opening sequence (the same position and
  // move played twice) — upsert with ignoreDuplicates so they merge into one
  // shared edge in the tree instead of erroring on the second insert. This is
  // exactly how a multi-chapter import's separate `writeMoves` calls end up
  // sharing prefixes once they're all writing into the same `repId`.
  const moveRows = params.moves.map((move) => ({
    repertoire_id: repId,
    from_position: fenToId.get(move.fromFen)!,
    to_position: fenToId.get(move.toFen)!,
    san: move.san,
    move_number: move.move_number,
    is_player_turn: move.is_player_turn,
    annotation: move.annotation,
    chapter_name: move.isChapterEnd && params.chapterLabel ? params.chapterLabel : null
  }));

  for (let i = 0; i < moveRows.length; i += CHUNK) {
    const chunk = moveRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('moves')
      .upsert(chunk, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
    if (error) return fail(`Failed to save moves: ${error.message}`);
  }
```

Replace with:

```ts
  // Multiple chapters can share an opening sequence (the same position and
  // move played twice) — every move in THIS call belongs to `chapterLabel`
  // (if given), whether it's a chapter-ending leaf or an interior move deep
  // in a shared prefix. Unlike the old leaf-only tagging, a shared edge that
  // multiple chapters use must know about ALL of them (not just whichever
  // chapter happened to write it first) — enumerateVariations scopes its
  // walk per chapter using this, and an edge invisible to a chapter's own
  // scope breaks that chapter's own path reconstruction. So conflicting
  // inserts merge chapter_names instead of being dropped (this call's own
  // chapter name gets added to whatever the row already has), which needs a
  // real upsert rather than `ignoreDuplicates: true`.
  const moveRows = params.moves.map((move) => ({
    repertoire_id: repId,
    from_position: fenToId.get(move.fromFen)!,
    to_position: fenToId.get(move.toFen)!,
    san: move.san,
    move_number: move.move_number,
    is_player_turn: move.is_player_turn,
    annotation: move.annotation,
    chapter_names: params.chapterLabel ? [params.chapterLabel] : []
  }));

  // A single chapter's own move list shouldn't legitimately repeat the same
  // edge, but a real Postgres upsert (unlike the old `ignoreDuplicates: true`
  // / `ON CONFLICT DO NOTHING`) ERRORS if one statement tries to affect the
  // same conflict key twice ("ON CONFLICT DO UPDATE command cannot affect
  // row a second time") — `ignoreDuplicates` tolerated that silently, so
  // switching to a real upsert needs this dedupe to stay safe. Merges
  // chapter_names for any such within-call repeat rather than just keeping
  // one arbitrarily.
  const dedupedMoveRows = Array.from(
    moveRows
      .reduce((map, row) => {
        const key = `${row.from_position}|${row.san}`;
        const existing = map.get(key);
        map.set(
          key,
          existing
            ? { ...row, chapter_names: Array.from(new Set([...existing.chapter_names, ...row.chapter_names])) }
            : row
        );
        return map;
      }, new Map<string, (typeof moveRows)[number]>())
      .values()
  );

  for (let i = 0; i < dedupedMoveRows.length; i += CHUNK) {
    const chunk = dedupedMoveRows.slice(i, i + CHUNK);

    // Look up which of this chunk's edges already exist (from an earlier
    // chapter in the same multi-chapter import sharing a prefix), so their
    // existing chapter_names can be merged rather than overwritten.
    const fromPositions = Array.from(new Set(chunk.map((m) => m.from_position)));
    const { data: existingRows, error: selectErr } = await supabase
      .from('moves')
      .select('from_position, san, chapter_names')
      .eq('repertoire_id', repId)
      .in('from_position', fromPositions);
    if (selectErr) return fail(`Failed to load existing moves: ${selectErr.message}`);

    const existingByKey = new Map(
      (existingRows ?? []).map((r: any) => [`${r.from_position}|${r.san}`, (r.chapter_names ?? []) as string[]])
    );
    const merged = chunk.map((m) => {
      const key = `${m.from_position}|${m.san}`;
      const existingNames = existingByKey.get(key) ?? [];
      return { ...m, chapter_names: Array.from(new Set([...existingNames, ...m.chapter_names])) };
    });

    const { error } = await supabase.from('moves').upsert(merged, { onConflict: 'repertoire_id,from_position,san' });
    if (error) return fail(`Failed to save moves: ${error.message}`);
  }
```

- [ ] **Step 3: Verify the build still compiles**

```bash
cd mychess
npm run check 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 4: Run the full test suite**

```bash
cd mychess
npm test 2>&1 | tail -15
```

Expected: all tests pass (`src/lib/server/pgn-import.ts` has no dedicated test file, per this codebase's established convention of exercising the I/O layer through the pure-logic tests and manual verification instead — see CLAUDE.md — so this task's correctness is verified through Task 6's manual re-upload).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/server/pgn-import.ts
git commit -m "feat: tag every move with its chapter(s), merging on conflict instead of dropping"
```

---

### Task 6: Full verification + manual re-upload

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite one more time from a clean state**

```bash
cd mychess
npm test 2>&1 | tail -15
npm run check 2>&1 | tail -10
```

Expected: 0 errors, all tests passing.

- [ ] **Step 2: Confirm migration 0048 has been applied**

Ask the user to confirm they've run `0048_move_chapter_names_array.sql` (from Task 1) in the Supabase dashboard SQL editor before proceeding — the code changes in Tasks 3–5 depend on the `chapter_names` column existing.

- [ ] **Step 3: Manual re-upload verification**

With the code deployed and the migration applied:
- Re-upload the real "Freeze the French — Exchange Variation for White.pgn" file as a coach.
- Confirm the import completes without error (previously this could crash mid-import during the finalize-shape step).
- Open the repertoire's practice picker / chapter list — confirm chapters render.
- Assign the repertoire to a player, open the assigned repertoire's chapter-selection UI, and click the whole-repertoire "deselect everything" checkbox — confirm it succeeds without the "Couldn't update that" error.
- Re-check a few chapters back on and confirm the solved/total counts look sane (roughly proportional to the number of chapters re-included, not wildly off).

## Reporting

Report one of: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED, with the manual verification results. If the real PGN still fails at any step, stop and report exactly which step and what error — don't attempt further fixes without discussing root cause first, per this project's systematic-debugging convention.

---

### Task 7: Follow-up migration — drop `moves.chapter_name`

**Files:**
- Create: `mychess/supabase/migrations/0049_drop_move_chapter_name.sql`

**Do not apply this migration until Task 6's manual verification has been confirmed successful.** It's written now so it's ready, not to be run immediately.

- [ ] **Step 1: Confirm no remaining code reads `chapter_name` (singular)**

```bash
cd mychess
grep -rn "chapter_name\b" src/ supabase/migrations/0048_move_chapter_names_array.sql
```

Expected: no matches in `src/` (only `chapter_names`, plural, should remain) — Tasks 3–5 already removed every read. If anything still references the singular column, stop and fix it before proceeding.

- [ ] **Step 2: Write the migration**

Create `mychess/supabase/migrations/0049_drop_move_chapter_name.sql`:

```sql
-- mychess/supabase/migrations/0049_drop_move_chapter_name.sql
-- Superseded by chapter_names (migration 0048) — every move now carries the
-- full set of chapters that use it, not just chapter-ending leaves. Nothing
-- in the codebase reads this column anymore (confirmed via a full-repo grep
-- before this migration was written). Do not apply until the chapter_names
-- rollout (0048 + the accompanying code changes) has been manually verified
-- working against a real large multi-chapter PGN import.
alter table public.moves drop column chapter_name;
```

- [ ] **Step 3: Present the migration to the user, with the explicit hold**

Tell the user this migration is ready but should only be run after they've confirmed Task 6's manual verification succeeded — paste its contents for them to run manually in the Supabase dashboard SQL editor once they're ready, per this project's convention.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add supabase/migrations/0049_drop_move_chapter_name.sql
git commit -m "chore: drop superseded moves.chapter_name column"
```
