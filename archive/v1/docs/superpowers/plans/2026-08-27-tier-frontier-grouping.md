# Tier-Frontier Variation Grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Practice variation picker, collapse variations that share an identical opening past the current tier ceiling into one group — so solving that shared prefix once satisfies every variation that shares it, without opening each one separately (GitHub issue #165).

**Architecture:** No changes to the tier-ceiling algorithm (`deriveChapterLevel`/`teachingCeilingMoveCount`) or the teaching state machine (`resolveTeachingStep`/`advanceTeachingProgress`) — both stay exactly as-is. Three small, additive changes: (1) `+server.ts`'s `locked` computation switches from each variation's raw own progress row to the already-tested shared-credit floor (`knownProgressFor`), so a sibling that's never been individually visited still shows as locked/paused the moment another sibling reaches the ceiling; (2) a new pure grouping function, `groupByCeilingPrefix`, buckets variations that currently extend past the ceiling by their real shared prefix (by `moveId`, not move text); (3) `VariationPicker.svelte` routes any not-yet-solved variation that extends past the ceiling into that new grouping (fully hiding its content beyond the ceiling), while everything else keeps rendering exactly as it does today.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript, Vitest + @testing-library/svelte.

---

## Before you start

Read these three files in full — every task below edits them, and the plan assumes you've seen their current shape:

- `mychess/src/routes/api/repertoires/[id]/variations/+server.ts`
- `mychess/src/lib/mastery/variations.ts`
- `mychess/src/lib/components/VariationPicker.svelte`

Also skim `mychess/src/lib/mastery/teaching.ts` — specifically `ceilingPlyFor`, `isPausedAtCeiling`, and `knownProgressFor` (lines ~60-281). This plan reuses all three unchanged; it does not modify `teaching.ts` at all.

**Key fact this plan depends on:** `locked` on a row does NOT mean "longer than the ceiling" — it means "already paused there" (`masteredPlies >= ceilingPly`). A variation that's never been taught shows `locked: false` even if it's much longer than the ceiling; it only flips to `locked: true` after teaching has reached the ceiling. The new grouping therefore keys off "does this row's own path extend past the ceiling" (`ceilingPlyFor(path, ceilingMoveCount) < path.length`), not off `locked` — a group can (and often will) contain not-yet-started rows, and clicking it should be a normal, live "start practicing" action, not a dead click.

---

### Task 1: `groupByCeilingPrefix` — shared-prefix grouping clipped to the ceiling

**Files:**
- Modify: `mychess/src/lib/mastery/variations.ts`
- Test: `mychess/src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `mychess/src/lib/mastery/variations.test.ts`. Add `groupByCeilingPrefix` to the import list at the top of the file (alongside the existing `groupByFirstMoves` import):

```ts
	groupByCeilingPrefix,
	groupByFirstMoves,
```

Then add this new `describe` block at the very end of the file (after the existing `describe('groupByFirstMoves', ...)` block's closing `});`):

```ts
describe('groupByCeilingPrefix', () => {
	function step(san: string, moveId: string): VariationStep {
		return { moveId, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true };
	}
	function item(id: string, path: VariationStep[]): { id: string; path: VariationStep[] } {
		return { id, path };
	}
	function stepsOf(x: { path: VariationStep[] }): VariationStep[] {
		return x.path;
	}
	function labels(groups: ReturnType<typeof groupByCeilingPrefix>) {
		return groups.map((g) => g.steps.map((s) => s.san));
	}
	function ids(group: ReturnType<typeof groupByCeilingPrefix>[number]) {
		return group.items.map((v: any) => v.id);
	}

	// Every ply here is `isPlayerTurn: true`, so `ceilingPlyFor(path, N)` clips
	// at exactly the Nth ply (see `ceilingPlyFor`'s own doc comment in
	// `teaching.ts` — it counts PLAYER plies, and every ply here is one).
	const shared = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'].map((san, i) => step(san, `shared-${i}`));

	it('groups two variations that share the same underlying moves up to the ceiling, even though their own paths continue further and differently', () => {
		const a = item('a', [...shared, step('a6', 'a-5'), step('Ba4', 'a-6')]);
		const b = item('b', [...shared, step('O-O', 'b-5'), step('d3', 'b-6')]);
		const groups = groupByCeilingPrefix([a, b], stepsOf, 3);
		expect(groups).toHaveLength(1);
		expect(labels(groups)).toEqual([['e4', 'e5', 'Nf3']]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
	});

	it('keeps two variations apart when their SAN text matches but the underlying moves do not (no real shared credit)', () => {
		const a = item('a', ['e4', 'e5', 'Nf3'].map((san, i) => step(san, `a-${i}`)));
		const b = item('b', ['e4', 'e5', 'Nf3'].map((san, i) => step(san, `b-${i}`)));
		const groups = groupByCeilingPrefix([a, b], stepsOf, 3);
		expect(groups).toHaveLength(2);
		expect(ids(groups[0])).toEqual(['a']);
		expect(ids(groups[1])).toEqual(['b']);
	});

	it('clips exactly at the ceiling ply, not at wherever the line actually continues', () => {
		const a = item('a', [...shared, step('a6', 'a-5')]); // 6 plies total
		const groups = groupByCeilingPrefix([a], stepsOf, 3);
		expect(labels(groups)).toEqual([['e4', 'e5', 'Nf3']]);
	});

	it('uses the full path when the ceiling is not shorter than it (nothing to clip)', () => {
		const a = item('a', shared); // exactly 5 plies
		const groups = groupByCeilingPrefix([a], stepsOf, 10);
		expect(labels(groups)).toEqual([shared.map((s) => s.san)]);
	});

	it('has no top-N cap — every distinct clipped prefix gets its own group', () => {
		const items = ['e4', 'd4', 'c4', 'Nf3', 'g3', 'b3', 'f4'].map((san, i) =>
			item(`v${i}`, [step(san, `m${i}-0`), step('x', `m${i}-1`), step('y', `m${i}-2`), step('z', `m${i}-3`)])
		);
		const groups = groupByCeilingPrefix(items, stepsOf, 1);
		expect(groups).toHaveLength(7); // no "Other" bucket, unlike groupByFirstMoves
	});

	it('returns an empty array for an empty item list', () => {
		expect(groupByCeilingPrefix([], stepsOf, 3)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/variations.test.ts`
Expected: FAIL — `groupByCeilingPrefix is not exported` / `is not a function`.

- [ ] **Step 3: Implement `groupByCeilingPrefix`**

In `mychess/src/lib/mastery/variations.ts`, add this import at the very top of the file, above the `RawMoveRow` type (the file currently has no imports at all):

```ts
import { ceilingPlyFor } from './teaching';
```

Then append this function at the end of the file, after `groupByFirstMoves`:

```ts
/**
 * Buckets variations that currently extend past the teaching ceiling by their
 * own shared prefix, clipped to exactly where `ceilingMoveCount` lands within
 * each item's own path (`ceilingPlyFor` — never a fixed depth, since a
 * batch's ply length depends on whose move it lands on). Two items land in
 * the same group only when their clipped prefixes are the SAME underlying
 * moves, compared by `moveId` rather than SAN text — matching exactly what
 * `knownProgressFor`'s shared-credit mechanic already treats as
 * interchangeable, so a group's members are always the same set of
 * variations that teaching one of them credits for every other (GitHub issue
 * #165).
 *
 * Unlike `groupByFirstMoves`, there is no fixed window and no top-N cap:
 * every distinct clipped prefix becomes its own group, in first-appearance
 * order. Callers should only pass items whose own path extends past the
 * ceiling (`ceilingPlyFor(path, ceilingMoveCount) < path.length`) — an item
 * that's already fully within the ceiling has nothing to clip, and belongs
 * on the regular (`groupByFirstMoves`) view instead.
 */
export function groupByCeilingPrefix<T>(
	items: T[],
	stepsOf: (item: T) => VariationStep[],
	ceilingMoveCount: number
): MoveGroup<T>[] {
	if (items.length === 0) return [];

	const clippedStepsOf = (item: T) => {
		const steps = stepsOf(item);
		return steps.slice(0, ceilingPlyFor(steps, ceilingMoveCount));
	};
	const keyOf = (item: T) =>
		clippedStepsOf(item)
			.map((s) => s.moveId)
			.join('>');

	const firstAppearanceOrder: string[] = [];
	const buckets = new Map<string, T[]>();
	const stepsByKey = new Map<string, VariationStep[]>();
	for (const item of items) {
		const key = keyOf(item);
		if (!buckets.has(key)) {
			firstAppearanceOrder.push(key);
			buckets.set(key, []);
			stepsByKey.set(key, clippedStepsOf(item));
		}
		buckets.get(key)!.push(item);
	}

	return firstAppearanceOrder.map((key) => ({
		steps: stepsByKey.get(key)!,
		items: buckets.get(key)!
	}));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/variations.test.ts`
Expected: PASS (all tests in the file, including the new `groupByCeilingPrefix` block).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/mastery/variations.ts mychess/src/lib/mastery/variations.test.ts
git commit -m "feat(mastery): add groupByCeilingPrefix for shared-prefix tier grouping"
```

---

### Task 2: Shared-credit-aware `locked`, plus `ceilingMoveCount` per row

**Files:**
- Modify: `mychess/src/routes/api/repertoires/[id]/variations/+server.ts`

No test file — per this repo's convention (see `CLAUDE.md`'s "Code split: pure logic vs. Supabase I/O"), route handlers that call into `$lib/server/*` are not unit-tested directly; this change is covered indirectly by Task 3's component tests (which exercise the row shape this route now produces) plus manual verification in Task 4.

- [ ] **Step 1: Replace the file's contents**

Replace the entire contents of `mychess/src/routes/api/repertoires/[id]/variations/+server.ts` with:

```ts
// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { fetchAllChapterExclusions, loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { moveSequenceLabel, UNTAGGED_CHAPTER } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isPausedAtCeiling, knownProgressFor } from '$lib/mastery/teaching';

// A null byte can't appear in a Postgres `text` value or a variation key (a
// `>`-joined chain of UUIDs), so joining a (chapter, variationKey) pair on it
// can't collide two distinct pairs onto the same lookup key. Unchanged from
// the existing file — keep whatever literal this constant already uses there
// (a null-byte string) rather than retyping it by hand.
const PAIR_SEP = String.fromCharCode(0);

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own per-chapter included/excluded state (one entry per chapter the
 * line belongs to, or a single UNTAGGED_CHAPTER entry for a genuinely
 * untagged line — GitHub issue #86), every originating PGN chapter (empty
 * for an untagged line — a line cross-referenced by several chapters is one
 * entry listing all of them, never one entry per chapter), full move path (for the picker's fixed-window move-group buckets, which
 * key on each variation's first FIRST_MOVES_GROUP_PLIES plies — not just the
 * first move), solved state, this variation's own player-move count (for
 * the picker to bucket/label by tier the same way the teaching ceiling
 * does), locked state — whether this UNSOLVED variation is currently paused
 * at the repertoire's teaching-tier ceiling — and this repertoire's current
 * ceiling itself (`ceilingMoveCount`, the same value repeated on every row
 * rather than a separate top-level field, so the response stays the flat
 * array `VariationSelection.ensureLoaded` also consumes, unchanged). The
 * picker renders a locked row disabled instead of letting the player click
 * into a dead end that `/api/practice/select-variation` would reject anyway
 * (GitHub issue #163), and groups/truncates rows whose own path currently
 * extends past the ceiling by their real shared prefix (GitHub issue #165).
 *
 * `locked` is computed from the SHARED-CREDIT-AWARE mastered-ply count
 * (`knownProgressFor`), not each variation's own raw progress row: a
 * variation whose entire visible opening is already mastered via a sibling
 * that shares those same moves must show as locked/paused immediately,
 * without requiring this specific variation to be individually taught first
 * — the same shared-credit floor `buildPracticeView` already applies at
 * serve time (`mastery/practice.ts`), just also applied here at picker-read
 * time (GitHub issue #165).
 *
 * Fetched lazily (only when a repertoire row is expanded or the picker is
 * opened), not eagerly for every repertoire, to avoid re-introducing the
 * full-move-fetch cost the shape cache exists to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations }, solvedKeys, chapterExclusions, teachingProgress] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id),
		fetchAllChapterExclusions(locals.supabase, user.id, params.id),
		loadTeachingProgress(locals.supabase, user.id, params.id)
	]);

	const ceilingMoveCount = teachingCeilingMoveCount(variations, solvedKeys);
	const excludedPairs = new Set(chapterExclusions.map((r) => `${r.chapter_name}${PAIR_SEP}${r.variation_key}`));

	return json(
		variations.map((v) => {
			const chapters = v.chapterNames.length > 0 ? v.chapterNames : [UNTAGGED_CHAPTER];
			const includedByChapter: Record<string, boolean> = {};
			for (const chapter of chapters) {
				includedByChapter[chapter] = !excludedPairs.has(`${chapter}${PAIR_SEP}${v.variationKey}`);
			}
			const solved = solvedKeys.has(v.variationKey);
			const masteredPlies = knownProgressFor({
				variation: v,
				variations,
				teachingProgress,
				solvedKeys,
				resumedAfterBreak: false
			}).masteredPlies;
			return {
				variationKey: v.variationKey,
				label: moveSequenceLabel(v.path),
				includedByChapter,
				chapterNames: v.chapterNames,
				path: v.path,
				solved,
				playerMoveCount: v.playerMoveCount,
				locked: !solved && isPausedAtCeiling(v.path, masteredPlies, ceilingMoveCount),
				ceilingMoveCount
			};
		})
	);
};
```

- [ ] **Step 2: Run the existing test suite to confirm nothing else broke**

Run: `cd mychess && npx vitest run src/lib/mastery/teaching.test.ts`
Expected: PASS — this task calls only already-tested `teaching.ts` exports, no changes to that file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/api/repertoires/[id]/variations/+server.ts
git commit -m "fix(api): credit the picker's locked state from shared mastery, not each row's own progress"
```

---

### Task 3: `VariationPicker.svelte` — route the ceiling frontier through the new grouping

**Files:**
- Modify: `mychess/src/lib/components/VariationPicker.svelte`
- Test: `mychess/src/lib/components/VariationPicker.test.ts`

- [ ] **Step 1: Extend the test file's `row()` helper**

In `mychess/src/lib/components/VariationPicker.test.ts`, replace the `row` function with:

```ts
function row(
	variationKey: string,
	sans: string[],
	chapterNames: string[],
	opts: { included?: boolean; solved?: boolean; locked?: boolean; ceilingMoveCount?: number } = {}
) {
	const included = opts.included ?? true;
	const chapters = chapterNames.length > 0 ? chapterNames : [UNTAGGED_CHAPTER];
	const includedByChapter: Record<string, boolean> = {};
	for (const c of chapters) includedByChapter[c] = included;
	return {
		variationKey,
		label: `label:${variationKey}`, // stand-in for the server's own moveSequenceLabel(v.path) — irrelevant to grouping
		includedByChapter,
		chapterNames,
		path: path(sans),
		solved: opts.solved ?? false,
		locked: opts.locked ?? false,
		// Defaults to Infinity — no row is ever "past the ceiling" unless a test
		// explicitly opts in, so every EXISTING test in this file (none of which
		// pass this option) is completely unaffected by ceiling-frontier grouping.
		ceilingMoveCount: opts.ceilingMoveCount ?? Infinity
	};
}
```

This is the only change existing tests need — `ceilingMoveCount` defaults to `Infinity`, under which `ceilingPlyFor(path, Infinity)` always equals `path.length` (see `teaching.ts`'s `plyAfterPlayerMoves` — the loop never reaches `Infinity` player moves, so it falls through to `path.length`), so no existing row is ever treated as "extending past the ceiling." Every one of the file's ~18 existing test bodies is untouched.

- [ ] **Step 2: Write the new failing tests**

Append this `describe` block at the end of `mychess/src/lib/components/VariationPicker.test.ts`, just before the final closing `});` of the outer `describe('VariationPicker', ...)` block:

```ts
	describe('ceiling-frontier grouping (GitHub issue #165)', () => {
		it('groups variations that share their opening past the ceiling into one clickable entry', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3 }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3 })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			// Truncated to the shared first 3 plies — the diverging 4th/5th moves
			// (a6/Ba4 vs O-O/d3) are never shown.
			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('(2)');
			expect(screen.queryByText('label:v1')).toBeNull();
			expect(screen.queryByText('label:v2')).toBeNull();

			await fireEvent.click(groupButton);
			expect(onselect).toHaveBeenCalledTimes(1);
			expect(['v1', 'v2']).toContain(onselect.mock.calls[0][0]);
		});

		it('shows a fully-paused ceiling group as done and disabled, without requiring a visit to each member', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton.textContent).toContain('Finish your current level first');
			expect(groupButton).toBeDisabled();
			await fireEvent.click(groupButton);
			expect(onselect).not.toHaveBeenCalled();
		});

		it('keeps a ceiling group clickable and targets a not-yet-paused member when only some siblings are already paused', async () => {
			const rows = [
				row('v1', ['e4', 'e5', 'Nf3', 'a6', 'Ba4'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: true }),
				row('v2', ['e4', 'e5', 'Nf3', 'O-O', 'd3'], ['Ruy Lopez'], { ceilingMoveCount: 3, locked: false })
			];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			const onselect = vi.fn();
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect, onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));

			const groupButton = screen.getByText('1.e4 e5 2.Nf3').closest('button')!;
			expect(groupButton).not.toBeDisabled();
			await fireEvent.click(groupButton);
			expect(onselect).toHaveBeenCalledWith('v2'); // the not-yet-paused member
		});

		it('does not group or truncate a variation whose own line never exceeds the ceiling', async () => {
			const rows = [row('v1', ['e4', 'e5'], ['Italian Game'], { ceilingMoveCount: 3 })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Italian Game'));
			await fireEvent.click(screen.getByText('Italian Game'));
			// Short enough to fit entirely under the ceiling — rendered via the
			// existing regular grouping (its own full label), not swept into a
			// ceiling-clipped entry.
			expect(screen.getByText('label:v1')).toBeTruthy();
		});

		it('a solved variation is never treated as a frontier row, even if it is long', async () => {
			const rows = [row('v1', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], ['Ruy Lopez'], { ceilingMoveCount: 3, solved: true })];
			const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
			vi.stubGlobal('fetch', fetchSpy);
			render(VariationPicker, { props: { repertoireId: 'rep-1', onselect: vi.fn(), onclose: vi.fn() } });

			await waitFor(() => screen.getByText('Ruy Lopez'));
			await fireEvent.click(screen.getByText('Ruy Lopez'));
			// Solved -> shown via the regular path with its own full label, not
			// truncated to the ceiling.
			expect(screen.getByText('label:v1')).toBeTruthy();
		});
	});
```

- [ ] **Step 3: Run the tests to verify the new ones fail (and existing ones still pass)**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: the ~18 pre-existing tests PASS; the 5 new tests in `ceiling-frontier grouping (GitHub issue #165)` FAIL (the component doesn't group by ceiling yet, so e.g. `screen.getByText('1.e4 e5 2.Nf3')` won't be found).

- [ ] **Step 4: Replace the component's contents**

Replace the entire contents of `mychess/src/lib/components/VariationPicker.svelte` with:

```svelte
<!-- mychess/src/lib/components/VariationPicker.svelte -->
<script lang="ts">
	import {
		groupByFirstMoves,
		groupByCeilingPrefix,
		moveSequenceLabel,
		chapterTiers,
		rowsInChapterTier,
		FIRST_MOVES_GROUP_PLIES,
		UNTAGGED_CHAPTER,
		type MoveGroup,
		type VariationStep
	} from '$lib/mastery/variations';
	import { ceilingPlyFor } from '$lib/mastery/teaching';
	import { m } from '$lib/paraglide/messages';
	import { isIncludedFor } from '$lib/mastery/variationSelection.svelte';

	type VariationRow = {
		variationKey: string;
		label: string;
		// One entry per chapter this line belongs to (a single UNTAGGED_CHAPTER
		// entry for a genuinely untagged line) — GitHub issue #86. This picker
		// is read-only (it never toggles inclusion, only lists what's
		// practiceable), so it only ever needs the "truly included" aggregate
		// (`isIncludedFor(row, null)`), never a single chapter's own entry.
		includedByChapter: Record<string, boolean>;
		// Every chapter this line belongs to — a line cross-referenced by two
		// chapters shows under both. Empty means untagged (see UNTAGGED_CHAPTER).
		chapterNames: string[];
		path: VariationStep[];
		solved: boolean;
		// Server-computed (see `/api/repertoires/[id]/variations`): true when this
		// variation sits above the player's current level. Never true alongside
		// `solved` — a solved line is by definition already reachable. This UI
		// disables and explains, purely as a courtesy; the real gate is
		// `/api/practice/select-variation`'s 403 (GitHub issue #163).
		locked: boolean;
		// This repertoire's current teaching-tier ceiling — the same value on
		// every row (see the server route's doc comment). Used to decide which
		// rows extend past what's currently teachable, and to clip their
		// display to that point (GitHub issue #165).
		ceilingMoveCount: number;
	};

	// One entry in the rendered move-group list: either a fixed-window bucket
	// from `groupByFirstMoves` (today's behavior, for anything already fully
	// within reach) or a ceiling-clipped bucket from `groupByCeilingPrefix`
	// (for variations that currently extend past the teaching ceiling —
	// GitHub issue #165). A tagged union, not two parallel arrays, so the
	// template renders one combined list in one pass.
	type PickerEntry = { kind: 'ceiling'; group: MoveGroup<VariationRow> } | { kind: 'regular'; group: MoveGroup<VariationRow> };

	let {
		repertoireId,
		onselect,
		onclose,
		variant = 'modal',
		currentVariationKey = null
	}: {
		repertoireId: string;
		onselect: (variationKey: string) => void;
		onclose?: () => void;
		// 'modal' (default) is the existing overlay, used on mobile everywhere
		// and as the "Switch variation" entry point on desktop too. 'inline'
		// renders as a permanent panel instead (GitHub issue #93's desktop
		// rail) — no backdrop, no close button, and it auto-opens to whatever
		// tier holds `currentVariationKey` instead of always starting
		// collapsed, since a permanent panel that's still hiding the current
		// line behind two clicks isn't earning its keep.
		variant?: 'modal' | 'inline';
		currentVariationKey?: string | null;
	} = $props();

	const TOP_N = 5;

	let variations = $state<VariationRow[] | null>(null);
	let openChapter = $state<string | null>(null);
	// Index into the currently-shown entry list, not the entry's own identity —
	// an index cleanly distinguishes "nothing opened yet" (`null`) from "the
	// Other bucket is opened" (an empty-steps group, but a real index), which
	// two otherwise-equal values couldn't.
	let openGroupIndex = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);
	// Whether the auto-open below has already run for the current
	// `currentVariationKey` — otherwise every subsequent load() (e.g. a
	// re-fetch after selecting a variation) would snap the rail back to the
	// active line even after the player had manually navigated elsewhere.
	let autoOpenedFor = $state<string | null>(null);

	function stepsOf(row: VariationRow): VariationStep[] {
		return row.path;
	}

	/**
	 * A variation whose own path currently extends past what Learn will teach
	 * — whether it's already paused there or simply hasn't reached it yet —
	 * so the picker never shows moves beyond the ceiling and never asks the
	 * player to separately visit several variations that share the exact same
	 * not-yet-reachable prefix (GitHub issue #165). A solved variation is
	 * never a frontier row: it's already past anything a ceiling could
	 * withhold.
	 */
	function isFrontier(row: VariationRow, ceilingMoveCount: number): boolean {
		return !row.solved && ceilingPlyFor(row.path, ceilingMoveCount) < row.path.length;
	}

	async function load() {
		try {
			const res = await fetch(`/api/repertoires/${repertoireId}/variations`);
			if (!res.ok) throw new Error('load failed');
			variations = await res.json();
			errorMessage = null;
		} catch {
			errorMessage = m.variation_picker_load_error();
		}
	}
	load();

	function includedRows(): VariationRow[] {
		return (variations ?? []).filter((r) => isIncludedFor(r, null));
	}

	// Chapters in first-appearance order, with the untagged bucket last; null
	// when no row is chaptered at all, which skips the chapter tier entirely in
	// the template below rather than making each ungrouped row its own group.
	const chapters = $derived.by(() => chapterTiers(includedRows()));

	// `null` is the flat, chapterless pool (only reachable when `chapters` is
	// null) — distinct from the untagged bucket WITHIN a chaptered repertoire,
	// which is a real tier name like any other.
	function rowsForChapter(chapter: string | null): VariationRow[] {
		const rows = includedRows();
		return chapter === null ? rows : rowsInChapterTier(rows, chapter);
	}

	/**
	 * The entries shown for one chapter (or the flat pool): every frontier row
	 * grouped by its ceiling-clipped shared prefix FIRST (the actionable "what
	 * do I still need to do" content), then everything else through the
	 * existing fixed-window grouping — unchanged from before this feature.
	 */
	function pickerEntries(chapter: string | null): PickerEntry[] {
		const rows = rowsForChapter(chapter);
		// Every row carries the same repertoire-wide ceiling (see the server
		// route) — read it off the first row rather than a separate prop, so
		// the response can stay the flat array `VariationSelection` also
		// consumes. Defaults to Infinity (nothing is ever "past the ceiling")
		// for an empty chapter, which is never actually rendered.
		const ceilingMoveCount = rows[0]?.ceilingMoveCount ?? Infinity;
		const frontierRows = rows.filter((r) => isFrontier(r, ceilingMoveCount));
		const regularRows = rows.filter((r) => !isFrontier(r, ceilingMoveCount));
		const ceilingGroups = groupByCeilingPrefix(frontierRows, stepsOf, ceilingMoveCount);
		const regularGroups = groupByFirstMoves(regularRows, stepsOf, FIRST_MOVES_GROUP_PLIES, TOP_N);
		return [
			...ceilingGroups.map((group) => ({ kind: 'ceiling' as const, group })),
			...regularGroups.map((group) => ({ kind: 'regular' as const, group }))
		];
	}

	function groupLabel(group: MoveGroup<VariationRow>): string {
		return group.steps.length > 0 ? moveSequenceLabel(group.steps) : m.variation_picker_other_group_label();
	}

	/**
	 * The single variation a move-group holds, or null if it holds several.
	 *
	 * A group's button is labelled with its shared opening moves, so a group of
	 * one reads as a variation already — drilling into it just showed a list of
	 * one row with a near-identical label (identical, for any line no longer
	 * than the grouping window). Groups of one are therefore selected directly
	 * instead, skipping a tier that carried no new information.
	 */
	function soleVariation(group: MoveGroup<VariationRow>): VariationRow | null {
		return group.items.length === 1 ? group.items[0] : null;
	}

	/** Whether every member of a ceiling group is already paused there — nothing left to practice until the tier ceiling itself advances. */
	function ceilingGroupDone(group: MoveGroup<VariationRow>): boolean {
		return group.items.every((r) => r.locked);
	}

	/** The member to actually practice when a ceiling group is selected — any not-yet-paused member if one exists (always selectable), else the first (only reachable when the whole group is done, and thus unclickable anyway). */
	function ceilingGroupRepresentative(group: MoveGroup<VariationRow>): VariationRow {
		return group.items.find((r) => !r.locked) ?? group.items[0];
	}

	/** Solved/total across a chapter's own rows — the rail's per-chapter indicator. */
	function chapterProgress(chapter: string): { solved: number; total: number } {
		const rows = rowsInChapterTier(includedRows(), chapter);
		return { solved: rows.filter((r) => r.solved).length, total: rows.length };
	}

	function isActive(variationKey: string): boolean {
		return currentVariationKey !== null && variationKey === currentVariationKey;
	}

	function chapterHasActive(chapter: string): boolean {
		return currentVariationKey !== null && rowsInChapterTier(includedRows(), chapter).some((r) => isActive(r.variationKey));
	}

	function groupHasActive(group: MoveGroup<VariationRow>): boolean {
		return currentVariationKey !== null && group.items.some((r) => isActive(r.variationKey));
	}

	const activeChapter = $derived(chapters === null ? null : openChapter);
	const currentEntries = $derived(activeChapter !== null || chapters === null ? pickerEntries(activeChapter) : []);
	const openEntry = $derived(openGroupIndex !== null ? currentEntries[openGroupIndex] ?? null : null);
	// Only a 'regular' entry can ever be drilled into — a ceiling entry always
	// selects directly (see the template), so it never sets `openGroupIndex`.
	const openGroup = $derived(openEntry?.kind === 'regular' ? openEntry.group : null);

	// Inline-only (see the `variant` prop doc comment above): opens straight to
	// whatever tier holds the active line instead of leaving a permanent panel
	// sitting on its collapsed top level.
	$effect(() => {
		if (variant !== 'inline' || !currentVariationKey || !variations) return;
		if (autoOpenedFor === currentVariationKey) return;
		const row = variations.find((v) => v.variationKey === currentVariationKey);
		if (!row) return;
		autoOpenedFor = currentVariationKey;
		const chapter = chapters === null ? null : row.chapterNames[0] ?? UNTAGGED_CHAPTER;
		openChapter = chapter;
		const entries = pickerEntries(chapter);
		const idx = entries.findIndex((e) => e.group.items.some((r) => r.variationKey === currentVariationKey));
		const found = idx >= 0 ? entries[idx] : null;
		// A ceiling entry (any size) and a regular group-of-one already render
		// their row directly in the entry list — drilling in would just show
		// the same row again behind a pointless "Back".
		openGroupIndex = found && found.kind === 'regular' && !soleVariation(found.group) ? idx : null;
	});
</script>

{#snippet body()}
	<div class="flex items-center justify-between mb-3">
		<h2 class="font-bold text-(--color-text)">{m.variation_picker_heading()}</h2>
		{#if variant === 'modal'}
			<button aria-label={m.picker_close_aria()} onclick={onclose} class="text-(--color-muted) hover:text-gray-600 dark:hover:text-gray-400">✕</button>
		{/if}
	</div>

	{#if variations === null}
		{#if errorMessage}
			<p class="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
		{:else}
			<p class="text-sm text-(--color-muted)">{m.variation_picker_loading()}</p>
		{/if}
	{:else if openGroup}
		<button onclick={() => (openGroupIndex = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
		<ul class="space-y-1">
			{#each openGroup.items as row (row.variationKey)}
				<li>
					<button
						disabled={row.locked}
						onclick={() => {
							if (!row.locked) onselect(row.variationKey);
						}}
						class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between {isActive(row.variationKey)
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''} {row.locked ? 'opacity-50 cursor-not-allowed' : ''}"
					>
						<span>{row.label}</span>
						{#if row.locked}
							<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
						{:else if row.solved}
							<span class="text-green-600 dark:text-green-400 text-sm">✓</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if activeChapter !== null || chapters === null}
		{#if chapters !== null}
			<button onclick={() => (openChapter = null)} class="text-(--color-accent) text-sm mb-2 hover:underline">{m.variation_picker_back()}</button>
		{/if}
		<ul class="space-y-1">
			{#each currentEntries as entry, i (entry.kind === 'ceiling' ? `ceiling-${entry.group.steps.map((s) => s.moveId).join('>')}` : entry.group.steps.map((s) => s.san).join('>') || `other-${i}`)}
				{#if entry.kind === 'ceiling'}
					{@const done = ceilingGroupDone(entry.group)}
					<li>
						<button
							disabled={done}
							onclick={() => {
								if (!done) onselect(ceilingGroupRepresentative(entry.group).variationKey);
							}}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between font-medium {groupHasActive(entry.group)
								? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
								: ''} {done ? 'opacity-50 cursor-not-allowed' : ''}"
						>
							<span>{moveSequenceLabel(entry.group.steps)}</span>
							<span class="flex items-center gap-2 shrink-0">
								{#if entry.group.items.length > 1}
									<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
								{/if}
								{#if done}
									<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
								{/if}
							</span>
						</button>
					</li>
				{:else}
					{@const only = soleVariation(entry.group)}
					<li>
						<!-- A group of one IS a variation, so it selects straight into
						     practice and renders like a variation row (own full label,
						     solved tick, no count) rather than as a folder holding one
						     item. Groups of several still drill in. -->
						<button
							disabled={only?.locked ?? false}
							onclick={() => {
								if (only) {
									if (!only.locked) onselect(only.variationKey);
								} else {
									openGroupIndex = i;
								}
							}}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-(--color-text) flex items-center justify-between {only
								? ''
								: 'font-medium'} {groupHasActive(entry.group) ? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10' : ''} {only?.locked
								? 'opacity-50 cursor-not-allowed'
								: ''}"
						>
							<span>{only ? only.label : groupLabel(entry.group)}</span>
							{#if only}
								{#if only.locked}
									<span class="text-xs text-(--color-muted)">{m.variation_picker_locked_reason()}</span>
								{:else if only.solved}
									<span class="text-green-600 dark:text-green-400 text-sm">✓</span>
								{/if}
							{:else}
								<span class="text-(--color-muted) text-sm">({entry.group.items.length})</span>
							{/if}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{:else}
		<ul class="space-y-1">
			{#each chapters ?? [] as chapter (chapter)}
				{@const progress = variant === 'inline' ? chapterProgress(chapter) : null}
				<li>
					<button
						onclick={() => (openChapter = chapter)}
						class="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 font-medium text-(--color-text) flex items-center justify-between gap-2 {chapterHasActive(chapter)
							? 'ring-2 ring-(--color-accent) bg-(--color-accent)/10'
							: ''}"
					>
						<span class="truncate">{chapter}</span>
						{#if progress}
							<span class="shrink-0 text-xs font-normal {progress.solved === progress.total ? 'text-green-600 dark:text-green-400' : 'text-(--color-muted)'}">
								{progress.solved === progress.total ? '✓' : `${progress.solved}/${progress.total}`}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if variant === 'modal'}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
		<div class="bg-(--color-surface) rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto p-4">
			{@render body()}
		</div>
	</div>
{:else}
	<div class="h-full flex flex-col bg-(--color-surface) border border-(--color-border) rounded-2xl shadow-sm overflow-y-auto p-4">
		{@render body()}
	</div>
{/if}
```

- [ ] **Step 5: Run the tests to verify they all pass**

Run: `cd mychess && npx vitest run src/lib/components/VariationPicker.test.ts`
Expected: PASS — all ~18 pre-existing tests AND the 5 new ceiling-frontier tests.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/components/VariationPicker.svelte mychess/src/lib/components/VariationPicker.test.ts
git commit -m "feat(learn): collapse same-prefix variations past the tier ceiling into one group"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `cd mychess && npm test`
Expected: PASS, zero failures.

- [ ] **Step 2: Run type/svelte checking**

Run: `cd mychess && npm run check`
Expected: zero errors (per `CLAUDE.md`: "`npm run check` and `npm run lint` must both report zero errors before pushing to `main`").

- [ ] **Step 3: Run lint**

Run: `cd mychess && npm run lint`
Expected: zero errors (warnings pre-existing/unrelated to this change are fine — see `CLAUDE.md`'s lint section).

- [ ] **Step 4: Manual verification in the browser**

Run: `cd mychess && npm run dev`

In a browser, sign in, open a repertoire with at least two variations that share an opening beyond move 9 (or seed one via the PGN import form using the exact 3-variation example from GitHub issue #165), open the Practice variation picker, and confirm:
- Two variations sharing an opening past the current tier ceiling appear as ONE group entry, labeled with only the shared moves (nothing past the ceiling visible).
- Clicking that group starts a normal practice session on one of the variations.
- After completing that practice session up to the ceiling, reopening the picker shows the group (or its remaining members) as done/disabled with "Finish your current level first", without having had to separately open the sibling variation(s).
- A variation whose own line fits entirely under the ceiling still renders normally (unchanged from before this feature).

Stop the dev server once verified.

---

## Self-review

**Spec coverage** (against the design agreed with the user in this conversation, GitHub issue #165):
- Ceiling-depth grouping using the EXISTING bronze/silver/gold player-move-count boundaries (not a new unit system) — Task 2/3 reuse `teachingCeilingMoveCount`/`ceilingPlyFor` unchanged; no new tier constants introduced. ✓
- Grouping by actual shared depth, not fixed tier-boundary-only matches — `groupByCeilingPrefix` clips to `ceilingPlyFor`'s real computed depth per path. ✓
- Fully automatic, no manual "family" tagging — grouping is derived live from `path`/`moveId`, no new user-facing config. ✓
- Retroactive (applies to existing repertoires, not just future uploads) — nothing is precomputed/persisted; grouping is computed live on every picker load, so it applies to every existing repertoire immediately. ✓
- Fully hidden beyond the ceiling — `moveSequenceLabel(entry.group.steps)` only ever receives the clipped steps; the underlying rows' full paths are never rendered for a ceiling entry. ✓
- Frontier-only scope (already-cleared content unaffected) — `isFrontier` excludes solved rows and rows fully within the ceiling; they render via the untouched `groupByFirstMoves` path. ✓
- Exact move-sequence match only, no transposition detection — `groupByCeilingPrefix` keys on literal `moveId` sequence identity. ✓
- Clicking a multi-member group starts practice directly, no intermediate "pick one" step — ceiling entries never set `openGroupIndex`. ✓
- No change to the tier-ceiling algorithm itself — `chapterLevels.ts` is untouched by this plan. ✓
- The "had to repeat the same moves on every variation" root cause (picker's `locked` not reflecting shared credit) — Task 2's `knownProgressFor` fix. ✓

**Placeholder scan:** no TBD/TODO, no "add appropriate handling" phrasing, every step has complete code, all commands have expected output stated.

**Type consistency:** `PickerEntry`, `VariationRow`, `MoveGroup<VariationRow>`, `groupByCeilingPrefix<T>`'s signature, and `ceilingGroupDone`/`ceilingGroupRepresentative`/`isFrontier` names and signatures are used identically across Task 1's export, Task 2's row shape, and Task 3's component — verified by re-reading Task 3's full file against Task 1/2's shapes.

---

## After implementation (not part of this plan's tasks — handled by the main session, not a subagent)

- Update GitHub issue #165's body to reflect this design (grouping happens live in the picker based on the existing tier ceiling, not at upload time as originally drafted).
- Run the `mp-code-review` skill (Standards + Spec) against the diff.
- Push to `main` once verification passes (per `CLAUDE.md`, no confirmation needed — this repo has no other users yet).
