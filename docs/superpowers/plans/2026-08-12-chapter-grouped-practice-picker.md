# Chapter-grouped Practice Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Practice picker's per-variation checkbox list groups variations by their originating PGN chapter (one collapsible header + bulk toggle per chapter) instead of showing a flat, combinatorially-large list of every leaf variation.

**Architecture:** Tag each PGN chapter's own leaf moves with a `chapter_name` column at import time; `enumerateVariations()` and every mastery/level/practice-alternatives function stay completely untouched (a `Variation`'s `chapterName` is just its leaf move's tag, carried through). Grouping happens only in the picker's client-side rendering.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + RLS), Vitest, all within the existing `mychess/` app (working directory for every command below).

**Design doc:** `docs/superpowers/specs/2026-08-12-chapter-grouped-practice-picker-design.md`
**GitHub issue:** [tomyka/mychess#54](https://github.com/tomyka/mychess/issues/54)

All file paths below are relative to `mychess/` (the SvelteKit app directory — one level below the repo root).

---

### Task 1: Migration — `moves.chapter_name` column

**Files:**
- Create: `supabase/migrations/0042_move_chapter_names.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0042_move_chapter_names.sql
-- Tags which PGN chapter a move closes out a line for, so the Practice
-- picker can group variations by chapter instead of showing every leaf
-- variation flat. Set only on moves that are a leaf WITHIN their own
-- chapter's own move set (every distinct line-ending inside that chapter,
-- including sidelines from the chapter's own internal PGN branches, not just
-- its mainline's final move) — see planMultiImport's chapterLeafFens.
-- Null for every other move, and for every move written before this
-- migration (no source PGN is stored anywhere, so there's nothing to
-- backfill from for already-imported repertoires).
alter table public.moves add column chapter_name text;
```

- [ ] **Step 2: Hand off to the user**

Per this repo's convention (see `CLAUDE.md` — no local Postgres/service-role key available), paste the file's contents to the user and ask them to run it in the Supabase dashboard SQL editor before continuing. Do not proceed to rely on this column existing until they confirm.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0042_move_chapter_names.sql
git commit -m "feat: add chapter_name column to moves"
```

---

### Task 2: Pure logic — tag each chapter's own leaf moves

**Files:**
- Modify: `src/lib/pgn-import.ts`
- Modify: `src/lib/pgn-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/pgn-import.test.ts` (inside the existing `describe('planMultiImport', ...)` block, right before its closing `});`):

```ts
  it('marks a chapter\'s own final move as isChapterEnd', () => {
    const result = planMultiImport('1. e4 e5 2. Nf3 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    expect(moves.map((m) => m.isChapterEnd)).toEqual([false, false, true]);
  });

  it('marks every distinct leaf when a chapter has its own internal branch', () => {
    // 1.e4 e5 2.Nf3 Nc6 (2...Nf6 3.Nxe5) 3.Bb5 — two lines within ONE
    // chapter: the mainline ending on Bb5, and the sideline ending on Nxe5.
    // Both are leaves of this chapter's own move graph and must both be
    // tagged, since grouping-by-chapter must not silently drop the sideline
    // out of the picker's checkbox list.
    const pgn = '1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5) 3. Bb5 *';
    const result = planMultiImport(pgn, 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    const bb5 = moves.find((m) => m.san === 'Bb5');
    const nxe5 = moves.find((m) => m.san === 'Nxe5');
    const nc6 = moves.find((m) => m.san === 'Nc6');
    expect(bb5?.isChapterEnd).toBe(true);
    expect(nxe5?.isChapterEnd).toBe(true);
    expect(nc6?.isChapterEnd).toBe(false); // has an outgoing move (Bb5), not a leaf
  });

  it('does not mark a mid-chapter move as isChapterEnd', () => {
    const result = planMultiImport('1. e4 e5 2. Nf3 Nc6 *', 'white');
    if ('error' in result) throw new Error('expected chapters, got error: ' + result.error);
    const moves = result[0].moves;
    expect(moves[0].isChapterEnd).toBe(false); // e4
    expect(moves[moves.length - 1].isChapterEnd).toBe(true); // Nc6, the real last move
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pgn-import.test.ts`
Expected: FAIL — `isChapterEnd` is `undefined` on every move (the field doesn't exist yet).

- [ ] **Step 3: Implement**

In `src/lib/pgn-import.ts`, update the `MoveRow` type and add a helper, then use it in `planMultiImport`:

```ts
export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
  // True when this move is a leaf WITHIN its own chapter's move set — see
  // chapterLeafFens. Used at write time (see `$lib/server/pgn-import.ts`) to
  // tag which moves close out a line for a given PGN chapter, so the
  // Practice picker can group variations by chapter later. Always false for
  // moves that don't come from a multi-chapter PGN import (e.g. the
  // chess.com/Lichess "my games" auto-import via `planGameImport`) — chapter
  // grouping doesn't apply there.
  isChapterEnd: boolean;
};
```

Add this function right above `planMultiImport`:

```ts
/**
 * Every `toFen` in `moves` that's never used as another move's `fromFen` —
 * i.e. every distinct line-ending position within one chapter's own moves,
 * including sidelines the chapter's own PGN branches into (not just its
 * mainline's final move). Used to tag which moves close out a chapter (see
 * `isChapterEnd` on `MoveRow`), so a variation ending on one of them can be
 * grouped under that chapter in the Practice picker.
 */
function chapterLeafFens(moves: { fromFen: string; toFen: string }[]): Set<string> {
  const fromFens = new Set(moves.map((m) => m.fromFen));
  return new Set(moves.map((m) => m.toFen).filter((fen) => !fromFens.has(fen)));
}
```

Replace `planMultiImport`'s body (the `chapters.map` call) with:

```ts
export function planMultiImport(pgnText: string, color: 'white' | 'black'): MultiImportPlan {
  const games = parsePgn(pgnText);

  const chapters: ImportChapter[] = games.map((game, index) => {
    const rawMoves = game.moves.map((move) => ({
      fromFen: move.parentFen,
      toFen: move.fen,
      san: move.san,
      move_number: move.ply,
      is_player_turn: move.color === color,
      annotation: move.annotation ?? null
    }));
    const leafFens = chapterLeafFens(rawMoves);
    const moves: MoveRow[] = rawMoves.map((m) => ({ ...m, isChapterEnd: leafFens.has(m.toFen) }));
    const opening = detectOpening(game.moves.map((m) => m.san), ECO_OPENINGS);
    return {
      name: chapterName(game.headers, index),
      moves,
      ecoCode: opening?.code ?? null,
      ecoName: opening?.name ?? null
    };
  });

  if (chapters.length === 0) {
    return { error: 'No valid games found in PGN' };
  }

  return chapters;
}
```

In `planGameImport`, update the `moves.push(...)` call to add the new required field (always `false` — chapter grouping doesn't apply to this import path):

```ts
    for (const move of game.moves) {
      moves.push({
        fromFen: move.parentFen,
        toFen: move.fen,
        san: move.san,
        move_number: move.ply,
        is_player_turn: move.color === color,
        annotation: move.annotation ?? null,
        isChapterEnd: false
      });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pgn-import.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgn-import.ts src/lib/pgn-import.test.ts
git commit -m "feat: tag each PGN chapter's own leaf moves with isChapterEnd"
```

---

### Task 3: Pure logic — carry `chapterName` through `enumerateVariations`

**Files:**
- Modify: `src/lib/mastery/variations.ts`
- Modify: `src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/mastery/variations.test.ts`, replace the `move()` helper with one that accepts an optional chapter name:

```ts
function move(
	id: string,
	fromPositionId: string,
	toPositionId: string,
	san: string,
	isPlayerTurn: boolean,
	chapterName: string | null = null
): RawMoveRow {
	return {
		id,
		fromPositionId,
		toPositionId,
		fromFen: `fen:${fromPositionId}`,
		toFen: `fen:${toPositionId}`,
		san,
		isPlayerTurn,
		chapterName
	};
}
```

Add this test inside the existing `describe('enumerateVariations', ...)` block:

```ts
	it('carries the leaf move\'s chapterName onto its Variation', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, null),
			move('m2', 'P1', 'P2', 'e5', false, null),
			move('m3', 'P2', 'P3', 'Nf3', true, 'Ruy Lopez')
		];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBe('Ruy Lopez');
	});

	it('defaults chapterName to null when the leaf move has none', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBeNull();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: FAIL — `RawMoveRow` has no `chapterName` field (type error) and `variation.chapterName` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/mastery/variations.ts`, update the three types and the `walk` function:

```ts
export type RawMoveRow = {
	id: string;
	fromPositionId: string;
	toPositionId: string;
	fromFen: string;
	toFen: string;
	san: string;
	isPlayerTurn: boolean;
	chapterName: string | null;
};

export type VariationStep = {
	moveId: string;
	san: string;
	fromFen: string;
	toFen: string;
	isPlayerTurn: boolean;
	chapterName: string | null;
};

export type Variation = {
	leafMoveId: string;
	variationKey: string;
	path: VariationStep[];
	playerMoveCount: number;
	// The originating PGN chapter's own bare title, carried from this
	// variation's leaf move (see `MoveRow.isChapterEnd` in `$lib/pgn-import.ts`
	// for how it's tagged at import time). Null for any variation whose leaf
	// isn't a tagged chapter-end — every variation of a repertoire imported
	// before chapter tagging existed, or of a single-chapter import, where
	// grouping doesn't apply.
	chapterName: string | null;
};
```

In `enumerateVariations`, update the `walk` function's leaf-push and step construction:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Run the type checker to confirm the expected fallout**

Run: `npm run check`
Expected: FAIL — Vitest itself won't catch this (it transpiles via esbuild without type-checking), but `svelte-check` will now report that every other `RawMoveRow` literal in the codebase (outside this task's own test file) is missing the required `chapterName` field. This is expected until Tasks 4 and 7 add it. Confirm the only errors are in `src/lib/server/pgn-import.ts` and `src/lib/server/practice-repertoire.ts`, not a regression in this task's own files. (`npx vitest run` on its own would still PASS at this point — it has nothing to do with this check.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mastery/variations.ts src/lib/mastery/variations.test.ts
git commit -m "feat: carry chapterName from a leaf move onto its Variation"
```

---

### Task 4: `writeMoves` — write `chapter_name` for a chapter's tagged leaf moves

**Files:**
- Modify: `src/lib/server/pgn-import.ts`

No dedicated test file for this task — per this repo's convention (`CLAUDE.md`), `src/lib/server/*` files touching Supabase are thin I/O wrappers exercised through the pure-logic tests plus manual/e2e verification, not unit-tested directly. This change is exercised end-to-end by Task 6's `PgnImportForm.test.ts` updates and by manual verification in Task 10.

- [ ] **Step 1: Fix the two `RawMoveRow` literals broken by Task 3**

In `src/lib/server/pgn-import.ts`, the `writeMoves` function builds a `RawMoveRow[]` directly from `params.moves` to compute a repertoire's shape eagerly. Add the new field (chapter grouping is irrelevant to shape math, so `null` is correct here regardless of the moves' real tags):

```ts
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

- [ ] **Step 2: Accept a `chapterLabel` param and write it onto tagged moves**

Update `writeMoves`'s params type (add `chapterLabel?: string` alongside the existing `existingRepertoireId`/`finalize`):

```ts
export async function writeMoves(
  supabase: SupabaseClient,
  params: {
    playerId: string;
    name: string;
    color: 'white' | 'black';
    ecoCode: string | null;
    ecoName: string | null;
    moves: MoveRow[];
    existingRepertoireId?: string;
    finalize?: boolean;
    // The originating PGN chapter's own bare title (e.g. `ImportChapter.name`
    // — "Ruy Lopez — Berlin Defense", NOT the combined "{repertoire name} —
    // {chapter title}" string `params.name` carries for a multi-chapter
    // import). Only ever sent for a multi-chapter import (see
    // `PgnImportForm.svelte`) — a single-chapter import has nothing to
    // group, so it's omitted and every move's `chapter_name` stays null.
    // Written only onto moves this call's own `MoveRow.isChapterEnd` marks
    // true — see `chapterLeafFens` in `$lib/pgn-import.ts`.
    chapterLabel?: string;
  }
): Promise<{ repertoireId: string | null; error: string | null }> {
```

Update the `moveRows` construction (the actual upsert payload) to include the new column:

```ts
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
```

- [ ] **Step 3: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS. (This file has no direct test of its own; this confirms nothing else broke. `npm run check` will still report one remaining type error in `src/lib/server/practice-repertoire.ts` at this point — that's Task 7, not a regression here.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/pgn-import.ts
git commit -m "feat: let writeMoves tag a chapter's leaf moves with chapter_name"
```

---

### Task 5: `/api/repertoires/import-chapter` — accept `chapterLabel`

**Files:**
- Modify: `src/routes/api/repertoires/import-chapter/+server.ts`

- [ ] **Step 1: Update `isMoveRow` and the endpoint**

Replace the file's contents with:

```ts
// mychess/src/routes/api/repertoires/import-chapter/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { writeMoves } from '$lib/server/pgn-import';
import type { MoveRow } from '$lib/pgn-import';

function isMoveRow(value: unknown): value is MoveRow {
	if (!value || typeof value !== 'object') return false;
	const m = value as Record<string, unknown>;
	return (
		typeof m.fromFen === 'string' &&
		typeof m.toFen === 'string' &&
		typeof m.san === 'string' &&
		typeof m.move_number === 'number' &&
		typeof m.is_player_turn === 'boolean' &&
		(m.annotation === null || typeof m.annotation === 'string') &&
		typeof m.isChapterEnd === 'boolean'
	);
}

/**
 * Writes one chapter's already-planned moves — either creating a new
 * repertoire, or (when `existingRepertoireId` is given) appending onto one
 * created by an earlier call in the same multi-chapter import. Called once
 * per chapter from the client (see `PgnImportForm.svelte`) so a multi-chapter
 * PGN import can show real per-chapter progress instead of one request
 * silently doing everything before replying, while every chapter still lands
 * in the SAME repertoire.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireApiUser(locals);

	const body = await request.json().catch(() => null);
	const { name, color, ecoCode, ecoName, moves, existingRepertoireId, finalize, chapterLabel } = body ?? {};

	if (typeof name !== 'string' || !name.trim()) throw error(400, 'name is required');
	if (color !== 'white' && color !== 'black') throw error(400, 'color must be "white" or "black"');
	if (ecoCode !== null && typeof ecoCode !== 'string') throw error(400, 'ecoCode must be a string or null');
	if (ecoName !== null && typeof ecoName !== 'string') throw error(400, 'ecoName must be a string or null');
	if (!Array.isArray(moves) || !moves.every(isMoveRow)) throw error(400, 'moves must be an array of move rows');
	if (existingRepertoireId !== undefined && typeof existingRepertoireId !== 'string') {
		throw error(400, 'existingRepertoireId must be a string');
	}
	if (finalize !== undefined && typeof finalize !== 'boolean') {
		throw error(400, 'finalize must be a boolean');
	}
	if (chapterLabel !== undefined && typeof chapterLabel !== 'string') {
		throw error(400, 'chapterLabel must be a string');
	}

	if (existingRepertoireId) {
		// `moves_player_all`'s RLS policy would reject the move writes below
		// anyway if this repertoire isn't the caller's own, but checking here
		// first turns that into a clean 404 instead of a generic write failure.
		const { data: owned } = await locals.supabase
			.from('repertoires')
			.select('id')
			.eq('id', existingRepertoireId)
			.eq('player_id', user.id)
			.maybeSingle();
		if (!owned) throw error(404, 'Repertoire not found');
	}

	const result = await writeMoves(locals.supabase, {
		playerId: user.id,
		name,
		color,
		ecoCode,
		ecoName,
		moves,
		existingRepertoireId,
		finalize,
		chapterLabel
	});
	if (result.error) throw error(400, result.error);

	return json({ repertoireId: result.repertoireId });
};
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/repertoires/import-chapter/+server.ts
git commit -m "feat: let import-chapter endpoint accept a chapterLabel"
```

---

### Task 6: `PgnImportForm.svelte` — send `chapterLabel` for multi-chapter imports

**Files:**
- Modify: `src/lib/components/PgnImportForm.svelte`
- Modify: `src/lib/components/PgnImportForm.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/components/PgnImportForm.test.ts`, replace the `'imports a multi-game PGN one chapter at a time into ONE shared repertoire'` test with:

```ts
	it('imports a multi-game PGN one chapter at a time into ONE shared repertoire', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		const twoGames = '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *';
		fillBasicForm('My Study', twoGames);
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
		const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
		expect(firstBody.name).toBe('My Study — Line A');
		expect(firstBody.chapterLabel).toBe('Line A'); // bare chapter title, not the combined name
		expect(firstBody.existingRepertoireId).toBeUndefined(); // creates the shared repertoire
		expect(firstBody.finalize).toBe(false); // not the last chapter — shape isn't complete yet
		expect(secondBody.name).toBe('My Study — Line B');
		expect(secondBody.chapterLabel).toBe('Line B');
		expect(secondBody.existingRepertoireId).toBe('r1'); // appends onto chapter 1's repertoire
		expect(secondBody.finalize).toBeUndefined(); // last chapter — defaults to true, computes real shape
	});
```

Replace the `'does not pass finalize or existingRepertoireId for a single-chapter import'` test with:

```ts
	it('does not pass finalize, existingRepertoireId, or chapterLabel for a single-chapter import', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.existingRepertoireId).toBeUndefined();
		expect(body.finalize).toBeUndefined();
		expect(body.chapterLabel).toBeUndefined();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: FAIL — `chapterLabel` is never sent yet.

- [ ] **Step 3: Update `handleSubmit`**

In `src/lib/components/PgnImportForm.svelte`, update the `fetch` call's body inside the `for` loop:

```ts
					const res: Response = await fetch('/api/repertoires/import-chapter', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							name: chapters[i].name,
							color,
							ecoCode: plan[i].ecoCode,
							ecoName: plan[i].ecoName,
							moves: plan[i].moves,
							...(sharedRepertoireId ? { existingRepertoireId: sharedRepertoireId } : {}),
							...(isMultiChapter && !isLastChapter ? { finalize: false } : {}),
							...(isMultiChapter ? { chapterLabel: plan[i].name } : {})
						})
					});
```

Also update the function's doc comment to mention the new field:

```ts
	/**
	 * Imports one chapter per request instead of one request doing every
	 * chapter before replying — the whole point being a real, per-chapter
	 * progress bar instead of the page just sitting there for a large
	 * multi-chapter PGN. Every chapter after the first passes
	 * `existingRepertoireId` so they all land in the SAME repertoire (see
	 * `writeMoves`) instead of each becoming its own. Every chapter EXCEPT
	 * THE LAST also passes `finalize: false`: `writeMoves` can only compute a
	 * correct shape (total_variations/total_levels/level1_task_count) once
	 * every chapter's moves are in, so only the last chapter lets it default
	 * to true, at which point it fetches the repertoire's complete move set
	 * and computes the real shape from that. Every chapter of a multi-chapter
	 * import also passes `chapterLabel` (the chapter's own bare PGN title,
	 * distinct from `name`'s combined "{repertoire} — {chapter}" string) so
	 * the Practice picker can later group this chapter's variations together
	 * — omitted for a single-chapter import, which has nothing to group.
	 *
	 * On failure, rolls back the one shared repertoire created so far (if
	 * any) — a multi-chapter import is all-or-nothing, matching the old
	 * single-request behavior's guarantee.
	 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/PgnImportForm.svelte src/lib/components/PgnImportForm.test.ts
git commit -m "feat: send each multi-chapter import chapter's bare title as chapterLabel"
```

---

### Task 7: `practice-repertoire.ts` — select and map `chapter_name`

**Files:**
- Modify: `src/lib/server/practice-repertoire.ts`

No dedicated test for this task, per the same `src/lib/server/*` convention as Task 4 — exercised by Task 8's endpoint change and Task 10's manual verification.

- [ ] **Step 1: Select the new column**

Update `MOVE_SELECT_COLUMNS`:

```ts
const MOVE_SELECT_COLUMNS =
	'id, san, is_player_turn, from_position, to_position, chapter_name, from_pos:from_position(fen), to_pos:to_position(fen)';
```

- [ ] **Step 2: Map it in `toRawMoveRows`**

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

- [ ] **Step 3: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS with zero type errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/practice-repertoire.ts
git commit -m "feat: carry chapter_name through practice-repertoire's move fetch"
```

---

### Task 8: `/api/repertoires/[id]/variations` — expose `chapterName`

**Files:**
- Modify: `src/routes/api/repertoires/[id]/variations/+server.ts`

- [ ] **Step 1: Update the endpoint**

```ts
// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state and its originating PGN chapter (if
 * any) — powers the Practice picker's expand-to-show-variations checkbox
 * list, grouped by chapter. Fetched lazily (only when a repertoire row is
 * expanded), not eagerly for every repertoire on the picker, to avoid
 * re-introducing the full-move-fetch cost the shape cache (see
 * `repertoire-progress.ts`) exists specifically to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const { variations, excludedVariationKeys } = await loadRepertoireVariations(locals.supabase, user.id, params.id);

	return json(
		variations.map((v) => ({
			variationKey: v.variationKey,
			label: moveSequenceLabel(v.path),
			included: !excludedVariationKeys.has(v.variationKey),
			chapterName: v.chapterName
		}))
	);
};
```

- [ ] **Step 2: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/repertoires/\[id\]/variations/+server.ts
git commit -m "feat: expose chapterName on the repertoire variations endpoint"
```

---

### Task 9: `RepertoirePracticeRow.svelte` — group variations by chapter

**Files:**
- Modify: `src/lib/components/RepertoirePracticeRow.svelte`
- Modify: `src/lib/components/RepertoirePracticeRow.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/components/RepertoirePracticeRow.test.ts`, add a chapter-tagged fixture and new tests. First, add this alongside the existing `variationsResponse` const:

```ts
const chapterVariationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4', included: true, chapterName: 'Ruy Lopez' },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: 'Ruy Lopez' },
	{ variationKey: 'v3', label: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', included: true, chapterName: 'Italian Game' }
];
```

Then add `chapterName: null` to every entry in the existing `variationsResponse` fixture, since `VariationRow` will make the field required:

```ts
const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', included: true, chapterName: null },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true, chapterName: null }
];
```

Add these tests at the end of the `describe('RepertoirePracticeRow', ...)` block:

```ts
	it('groups variations under a chapter header when they share a chapterName', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => chapterVariationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('Ruy Lopez (chapter)')).toBeTruthy());
		expect(screen.getByText('Italian Game (chapter)')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4')).toBeTruthy();
		expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5')).toBeTruthy();
	});

	it('renders a flat list with no chapter header when no variation has a chapterName', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeTruthy());
		expect(screen.queryByText('(chapter)', { exact: false })).toBeNull();
	});

	it('shows a chapter checkbox as indeterminate when only some of its own variations are included, independent of a sibling chapter', async () => {
		const partial = chapterVariationsResponse.map((v) => (v.variationKey === 'v1' ? { ...v, included: false } : v));
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => partial });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(ruyCheckbox.indeterminate).toBe(true); // v1 excluded, v2 included
		expect(italianCheckbox.checked).toBe(true); // v3 included, unaffected by Ruy Lopez's state
	});

	it('bulk-toggling a chapter checkbox only excludes that chapter\'s own variations', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => chapterVariationsResponse })
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, totalVariations: 3, fullVariationCount: 3 } } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('Ruy Lopez (chapter)'));

		const ruyCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez \(chapter\)/ }) as HTMLInputElement;
		await fireEvent.click(ruyCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: false }) // NOT v3
			})
		);
		const italianCheckbox = screen.getByRole('checkbox', { name: /Italian Game \(chapter\)/ }) as HTMLInputElement;
		expect(italianCheckbox.checked).toBe(true); // untouched by Ruy Lopez's bulk-exclude

		await fireEvent.click(ruyCheckbox); // re-check — restores exactly v1 + v2
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1', 'v2'], included: true })
			})
		);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/RepertoirePracticeRow.test.ts`
Expected: FAIL — no chapter grouping exists yet; `VariationRow` has no `chapterName` field.

- [ ] **Step 3: Implement the component**

Replace `src/lib/components/RepertoirePracticeRow.svelte`'s `<script>` block with:

```svelte
<script lang="ts">
	import { levelTag } from '$lib/mastery/tags';

	type RepSummary = {
		id: string;
		name: string;
		color: string;
		level: number | 'mastered';
		totalLevels: number;
		levelTaskCount: number;
		levelSolvedCount: number;
		totalVariations: number;
		fullVariationCount: number;
		excludedVariationCount: number;
	};
	type VariationRow = { variationKey: string; label: string; included: boolean; chapterName: string | null };
	type ChapterGroup = { chapterName: string | null; rows: VariationRow[] };

	let { rep }: { rep: RepSummary } = $props();

	let expanded = $state(false);
	let variations = $state<VariationRow[] | null>(null);
	let loadingVariations = $state(false);
	let errorMessage = $state<string | null>(null);
	// Keyed by toggle scope ('__all__' for the repertoire-level checkbox, or
	// `chapter:{chapterName}` for one chapter's own checkbox) — the set of
	// variationKeys that were included right before that scope's checkbox
	// last bulk-excluded everything, so re-checking it restores exactly that
	// selection instead of blanket-including everything. Independent per
	// scope: bulk-excluding one chapter never touches another chapter's or
	// the repertoire-level checkbox's own snapshot.
	let snapshots = $state<Map<string, Set<string>>>(new Map());

	const checkedCount = $derived(
		variations ? variations.filter((v) => v.included).length : rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(variations ? variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	// Preserves first-seen order: a chapter's rows cluster together at the
	// position its first row appeared in `variations`; a null chapterName
	// (no chapter tag — every variation of a pre-feature or single-chapter
	// repertoire) becomes its OWN single-row group rather than one shared
	// group, so the template's ungrouped branch (no header, no wrapper)
	// reproduces today's flat rendering exactly when nothing is tagged.
	const groupedVariations = $derived.by<ChapterGroup[]>(() => {
		const list = variations ?? [];
		const groups: ChapterGroup[] = [];
		const indexByChapter = new Map<string, number>();
		for (const row of list) {
			if (row.chapterName === null) {
				groups.push({ chapterName: null, rows: [row] });
				continue;
			}
			const existingIndex = indexByChapter.get(row.chapterName);
			if (existingIndex === undefined) {
				indexByChapter.set(row.chapterName, groups.length);
				groups.push({ chapterName: row.chapterName, rows: [row] });
			} else {
				groups[existingIndex].rows.push(row);
			}
		}
		return groups;
	});

	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(newValue: boolean) {
				node.indeterminate = newValue;
			}
		};
	}

	/** Checked/unchecked/indeterminate aggregate for an arbitrary subset of variation rows. */
	function aggregateState(rows: VariationRow[]): 'checked' | 'unchecked' | 'indeterminate' {
		if (rows.length === 0) return 'checked';
		const included = rows.filter((v) => v.included).length;
		return included === rows.length ? 'checked' : included === 0 ? 'unchecked' : 'indeterminate';
	}

	async function ensureVariationsLoaded(): Promise<VariationRow[]> {
		if (variations) return variations;
		loadingVariations = true;
		try {
			const res = await fetch(`/api/repertoires/${rep.id}/variations`);
			if (!res.ok) throw new Error('load failed');
			const data = (await res.json()) as VariationRow[];
			variations = data;
			errorMessage = null;
			return data;
		} catch {
			errorMessage = "Couldn't load variations — try again.";
			throw new Error('load failed');
		} finally {
			loadingVariations = false;
		}
	}

	async function toggleExpanded() {
		expanded = !expanded;
		if (expanded) {
			try {
				await ensureVariationsLoaded();
			} catch {
				// errorMessage is already set inside ensureVariationsLoaded.
			}
		}
	}

	async function postExclusion(variationKeys: string[], included: boolean): Promise<boolean> {
		try {
			const res = await fetch(`/api/repertoires/${rep.id}/exclusions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys, included })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function toggleVariation(key: string) {
		let list: VariationRow[];
		try {
			list = await ensureVariationsLoaded();
		} catch {
			return;
		}
		const target = list.find((v) => v.variationKey === key);
		if (!target) return;
		const nextIncluded = !target.included;
		variations = list.map((v) => (v.variationKey === key ? { ...v, included: nextIncluded } : v));
		const ok = await postExclusion([key], nextIncluded);
		if (!ok) {
			variations = list;
			errorMessage = "Couldn't update that — try again.";
		} else {
			errorMessage = null;
		}
	}

	/**
	 * Bulk-toggles every currently-loaded variation for which `belongsToGroup`
	 * is true — used for both the repertoire-level checkbox (every variation)
	 * and each chapter header's own checkbox (just that chapter's rows).
	 * `scopeKey` isolates the uncheck/recheck snapshot per toggle so they
	 * never interfere with each other (see `snapshots`' doc comment above).
	 */
	async function toggleGroup(scopeKey: string, belongsToGroup: (row: VariationRow) => boolean) {
		let list: VariationRow[];
		try {
			list = await ensureVariationsLoaded();
		} catch {
			return;
		}
		const rows = list.filter(belongsToGroup);
		const state = aggregateState(rows);

		if (state !== 'unchecked') {
			// Checked or indeterminate -> bulk-exclude this scope's rows,
			// remembering exactly which ones were included so a re-check can
			// restore them. Only the currently-included keys are posted — an
			// already-excluded variation doesn't need a redundant write.
			const included = rows.filter((v) => v.included).map((v) => v.variationKey);
			const previousSnapshots = snapshots;
			snapshots = new Map(snapshots).set(scopeKey, new Set(included));
			variations = list.map((v) => (belongsToGroup(v) ? { ...v, included: false } : v));
			const ok = await postExclusion(included, false);
			if (!ok) {
				variations = list;
				snapshots = previousSnapshots;
				errorMessage = "Couldn't update that — try again.";
			} else {
				errorMessage = null;
			}
			return;
		}

		// Unchecked -> restore the pre-uncheck selection if we have one from
		// this visit, otherwise default to including everything in scope.
		const rowKeys = new Set(rows.map((v) => v.variationKey));
		const toInclude = snapshots.get(scopeKey) ?? rowKeys;
		const previousSnapshots = snapshots;
		variations = list.map((v) => (belongsToGroup(v) ? { ...v, included: toInclude.has(v.variationKey) } : v));
		const nextSnapshots = new Map(snapshots);
		nextSnapshots.delete(scopeKey);
		snapshots = nextSnapshots;
		const ok = await postExclusion([...toInclude], true);
		if (!ok) {
			variations = list;
			snapshots = previousSnapshots;
			errorMessage = "Couldn't update that — try again.";
		} else {
			errorMessage = null;
		}
	}

	function toggleParent() {
		return toggleGroup('__all__', () => true);
	}

	function toggleChapter(chapterName: string) {
		return toggleGroup(`chapter:${chapterName}`, (v) => v.chapterName === chapterName);
	}
</script>
```

Replace the `{#if expanded}` block in the template with:

```svelte
	{#if expanded}
		<ul class="pl-14 pr-4 pb-3 space-y-1">
			{#if loadingVariations}
				<li class="text-sm text-gray-400">Loading variations…</li>
			{:else}
				{#each groupedVariations as group, i (group.chapterName ?? `_ungrouped_${i}`)}
					{#if group.chapterName}
						<li>
							<label class="flex items-center gap-2 text-sm font-medium text-gray-600 mt-2">
								<input
									type="checkbox"
									checked={aggregateState(group.rows) === 'checked'}
									use:indeterminate={aggregateState(group.rows) === 'indeterminate'}
									onchange={() => toggleChapter(group.chapterName ?? '')}
									aria-label={`Include ${group.chapterName} (chapter) in practice`}
								/>
								{group.chapterName} (chapter)
							</label>
							<ul class="pl-6 space-y-1">
								{#each group.rows as variation (variation.variationKey)}
									<li>
										<label class="flex items-center gap-2 text-sm text-gray-700">
											<input
												type="checkbox"
												checked={variation.included}
												onchange={() => toggleVariation(variation.variationKey)}
											/>
											{variation.label}
										</label>
									</li>
								{/each}
							</ul>
						</li>
					{:else}
						{#each group.rows as variation (variation.variationKey)}
							<li>
								<label class="flex items-center gap-2 text-sm text-gray-700">
									<input
										type="checkbox"
										checked={variation.included}
										onchange={() => toggleVariation(variation.variationKey)}
									/>
									{variation.label}
								</label>
							</li>
						{/each}
					{/if}
				{/each}
			{/if}
		</ul>
	{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/RepertoirePracticeRow.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS with zero type errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/RepertoirePracticeRow.svelte src/lib/components/RepertoirePracticeRow.test.ts
git commit -m "feat: group the Practice picker's variation checkboxes by PGN chapter"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every file touched in Tasks 1-9.

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: zero errors (per `CLAUDE.md`, this is the hard gate before pushing to `main`).

- [ ] **Step 3: Manually verify chapter grouping end-to-end**

With `npm run dev` running and Task 1's migration confirmed applied: import a PGN with 2+ chapters sharing an opening (e.g. two `[Event "..."]` blocks, one titled "Ruy Lopez" ending `3. Bb5 a6`, one titled "Italian Game" ending `3. Bc4 Bc5`), then on the Practice picker (`/practice`):
- Expand the repertoire and confirm two chapter headers appear, each labeled with its own PGN chapter title (not a move-sequence preview) and its own "check all/none" checkbox.
- Uncheck one chapter's checkbox; confirm only that chapter's own rows uncheck, the other chapter's rows and checkbox are untouched, and the repertoire-level checkbox goes indeterminate.
- Re-check that chapter's checkbox; confirm it restores exactly the rows that were checked before, not everything.

- [ ] **Step 4: Manually verify a pre-existing repertoire has no regression**

Open a repertoire imported before this feature shipped (or import a fresh single-chapter PGN) on the Practice picker and confirm its expanded variation list renders exactly as before — flat, no chapter header, no visual change.

- [ ] **Step 5: Refactor pass**

Per `CLAUDE.md`'s "after finishing a major feature" convention: re-read every file touched in Tasks 1-9 for duplicated logic, dead code, or drift from the pure-logic-in-`lib`/I-O-in-`lib/server` split. Fix anything cheap inline; file a GitHub issue (`gh issue create`) for anything bigger.

- [ ] **Step 6: Push**

```bash
git push
```

(Per this repo's convention — production is the test environment and there are no other users yet — push directly to `main` without asking first, per `CLAUDE.md`.)

---

## Post-plan reminders

- Task 1's migration requires the user to take a manual action outside this plan's control (running SQL in the Supabase dashboard). Do not mark the overall feature done until the user has confirmed it.
- The GitHub issue (#54) should be closed (`gh issue close 54`) once Task 10 is complete and pushed — including a comment noting the final resolution was "group in the UI, don't collapse `enumerateVariations()`" for anyone who reads the issue later expecting the originally-proposed literal-collapse approach.
