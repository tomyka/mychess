# Hierarchical Repertoire → Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-chapter PGN imports produce one repertoire with many variations instead of splitting into N separate repertoires, and players get per-repertoire and per-variation "include in practice" checkboxes on the Practice picker.

**Architecture:** Merge multi-chapter PGN imports into a single repertoire's move tree (the existing `enumerateVariations()` already turns branch points in one move tree into separate "variations" — no new grouping schema needed). Add a new per-player `variation_practice_exclusions` table (presence of a row = excluded; absence = included) and filter `enumerateVariations()`'s output through it everywhere practice logic consumes variations. Rework the Practice picker into collapsible rows with checkboxes. Ship a one-off script to merge already-split repertoires in the current database.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + RLS), Vitest, all within the existing `mychess/` app (working directory for every command below).

**Design doc:** `docs/superpowers/specs/2026-08-12-hierarchical-repertoire-variations-design.md`
**GitHub issue:** [tomyka/mychess#51](https://github.com/tomyka/mychess/issues/51)

All file paths below are relative to `mychess/` (the SvelteKit app directory — one level below the repo root).

---

### Task 1: Migration — `variation_practice_exclusions` table

**Files:**
- Create: `supabase/migrations/0041_variation_practice_exclusions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0041_variation_practice_exclusions.sql
-- Per-player "exclude this variation from practice" state. Presence of a row
-- means excluded; absence means included — so the default (nothing recorded)
-- is "everything selected" with zero rows to write at import time.
--
-- Keyed like variation_progress (player_id + variation_key, unique together):
-- a repertoire can be assigned by a coach to many students via
-- assigned_repertoires (same row, many players), so this can't be a column
-- on repertoires itself without one student's exclusion affecting everyone
-- else assigned the same repertoire.
create table public.variation_practice_exclusions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles(id) on delete cascade,
  repertoire_id uuid not null references public.repertoires(id) on delete cascade,
  variation_key text not null,
  created_at    timestamptz not null default now(),
  unique (player_id, variation_key)
);

create index variation_practice_exclusions_player_repertoire_idx
  on public.variation_practice_exclusions (player_id, repertoire_id);

alter table public.variation_practice_exclusions enable row level security;

create policy "variation_practice_exclusions_player_all" on public.variation_practice_exclusions
  for all using (player_id = auth.uid());

revoke all on public.variation_practice_exclusions from anon, public;
```

- [ ] **Step 2: Hand off to the user**

Per this repo's convention (see `CLAUDE.md` — no local Postgres/service-role key available), paste the file's contents to the user and ask them to run it in the Supabase dashboard SQL editor before continuing. Do not proceed to rely on this table existing until they confirm.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0041_variation_practice_exclusions.sql
git commit -m "feat: add variation_practice_exclusions table"
```

---

### Task 2: Pure logic — filter variations and build a move-sequence label

**Files:**
- Modify: `src/lib/mastery/variations.ts`
- Modify: `src/lib/mastery/variations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/mastery/variations.test.ts` (add to the existing `import` line: `enumerateVariations, filterVariations, moveSequenceLabel, type RawMoveRow` — replacing the current `enumerateVariations, type RawMoveRow` import):

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: FAIL — `filterVariations` and `moveSequenceLabel` are not exported from `./variations`.

- [ ] **Step 3: Implement**

Append to `src/lib/mastery/variations.ts`:

```ts
/** `variations` with any entry whose `variationKey` is in `excludedKeys` dropped. */
export function filterVariations(variations: Variation[], excludedKeys: ReadonlySet<string>): Variation[] {
	if (excludedKeys.size === 0) return variations;
	return variations.filter((v) => !excludedKeys.has(v.variationKey));
}

/**
 * A human-readable move-sequence preview for one variation, e.g.
 * "1.e4 e5 2.Nf3 Nc6 3.Bb5" — assumes `path` starts from the game's actual
 * first move (true for every repertoire `enumerateVariations` produces,
 * since a root position never has an incoming edge), so index 0 is always
 * White's move 1.
 */
export function moveSequenceLabel(path: VariationStep[]): string {
	return path.map((step, i) => (i % 2 === 0 ? `${i / 2 + 1}.${step.san}` : step.san)).join(' ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/variations.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/variations.ts src/lib/mastery/variations.test.ts
git commit -m "feat: add filterVariations and moveSequenceLabel to mastery/variations"
```

---

### Task 3: Pure logic — plan which existing repertoires to merge

**Files:**
- Create: `src/lib/repertoire-merge.ts`
- Create: `src/lib/repertoire-merge.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/repertoire-merge.test.ts
import { describe, it, expect } from 'vitest';
import { planRepertoireMerges, type MergeCandidate } from './repertoire-merge';

function candidate(overrides: Partial<MergeCandidate> & { id: string }): MergeCandidate {
	return {
		playerId: 'player-1',
		color: 'white',
		name: 'My Study',
		createdAt: '2026-01-01T00:00:00Z',
		...overrides
	};
}

describe('planRepertoireMerges', () => {
	it('groups chapters sharing the same player, color, and base name', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-02T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2'] }]);
	});

	it('picks the earliest-created repertoire as canonical regardless of input order', () => {
		const candidates = [
			candidate({ id: 'r2', name: 'My Study — Line B', createdAt: '2026-01-02T00:00:00Z' }),
			candidate({ id: 'r1', name: 'My Study — Line A', createdAt: '2026-01-01T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2'] }]);
	});

	it('leaves a group of one alone (nothing to merge)', () => {
		const candidates = [candidate({ id: 'r1', name: 'Solo Repertoire' })];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge across different players', () => {
		const candidates = [
			candidate({ id: 'r1', playerId: 'player-1', name: 'My Study — Line A' }),
			candidate({ id: 'r2', playerId: 'player-2', name: 'My Study — Line B' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge across different colors', () => {
		const candidates = [
			candidate({ id: 'r1', color: 'white', name: 'My Study — Line A' }),
			candidate({ id: 'r2', color: 'black', name: 'My Study — Line B' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('does not merge repertoires with unrelated names', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Sicilian Defense' }),
			candidate({ id: 'r2', name: 'Ruy Lopez' })
		];
		expect(planRepertoireMerges(candidates)).toEqual([]);
	});

	it('groups three or more chapters from the same import into one merge group', () => {
		const candidates = [
			candidate({ id: 'r1', name: 'Study — A', createdAt: '2026-01-01T00:00:00Z' }),
			candidate({ id: 'r2', name: 'Study — B', createdAt: '2026-01-02T00:00:00Z' }),
			candidate({ id: 'r3', name: 'Study — C', createdAt: '2026-01-03T00:00:00Z' })
		];
		const merges = planRepertoireMerges(candidates);
		expect(merges).toEqual([{ canonicalId: 'r1', duplicateIds: ['r2', 'r3'] }]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/repertoire-merge.test.ts`
Expected: FAIL — `./repertoire-merge` does not exist.

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/repertoire-merge.ts
export type MergeCandidate = {
	id: string;
	playerId: string;
	color: 'white' | 'black';
	name: string;
	createdAt: string;
};

export type MergeGroup = { canonicalId: string; duplicateIds: string[] };

/**
 * `PgnImportForm.svelte` names a multi-chapter import's chapters
 * "{name} — {chapter}" (see `chapterName` in `pgn-import.ts`) — stripping
 * everything from " — " onward recovers the shared base name chapters split
 * from the same import were given.
 */
function baseName(name: string): string {
	return name.split(' — ')[0];
}

/**
 * Groups repertoires that were split at import time from one multi-chapter
 * PGN back together (same player, same color, same base name), earliest-
 * created member of each group of 2+ becoming canonical. Groups of exactly
 * one member are omitted — there's nothing to merge.
 */
export function planRepertoireMerges(candidates: MergeCandidate[]): MergeGroup[] {
	const groups = new Map<string, MergeCandidate[]>();
	for (const c of candidates) {
		const key = `${c.playerId}|${c.color}|${baseName(c.name)}`;
		const list = groups.get(key) ?? [];
		list.push(c);
		groups.set(key, list);
	}

	const merges: MergeGroup[] = [];
	for (const list of groups.values()) {
		if (list.length < 2) continue;
		const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const [canonical, ...duplicates] = sorted;
		merges.push({ canonicalId: canonical.id, duplicateIds: duplicates.map((d) => d.id) });
	}
	return merges;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/repertoire-merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/repertoire-merge.ts src/lib/repertoire-merge.test.ts
git commit -m "feat: add planRepertoireMerges for merging split repertoires"
```

---

### Task 4: `writeMoves` — support appending to an existing repertoire

**Files:**
- Modify: `src/lib/server/pgn-import.ts:64-178`

No dedicated test file for this task — per this repo's convention (`CLAUDE.md`), `src/lib/server/*` files touching Supabase are thin I/O wrappers exercised through the pure-logic tests plus manual/e2e verification, not unit-tested directly. This change is exercised end-to-end by Task 6's `PgnImportForm.test.ts` updates and by manual verification in Task 16.

- [ ] **Step 1: Modify `writeMoves`'s signature and repertoire-creation branch**

In `src/lib/server/pgn-import.ts`, replace the `writeMoves` function (lines 64-178) with:

```ts
/**
 * Creates one repertoire from a chapter's worth of moves (or appends to an
 * existing one, via `existingRepertoireId`), then chunk-upserts its
 * positions and moves into its tree. Public: called directly by
 * `/api/repertoires/import-chapter` so a multi-chapter PGN can be imported
 * chapter-by-chapter from the client with a real progress bar, while every
 * chapter's moves land in ONE shared repertoire (see the design doc linked
 * in the PR/issue) instead of each chapter becoming its own repertoire row.
 */
export async function writeMoves(
  supabase: SupabaseClient,
  params: {
    playerId: string;
    name: string;
    color: 'white' | 'black';
    ecoCode: string | null;
    ecoName: string | null;
    moves: MoveRow[];
    // Set when this call appends another chapter's moves onto a repertoire
    // an earlier call in the same multi-chapter import already created.
    existingRepertoireId?: string;
    // True for a multi-chapter import's chapters (creating OR appending) —
    // this call only ever sees ONE chapter's moves, so it cannot correctly
    // compute the repertoire's full shape (total_variations/total_levels/
    // level1_task_count spans every chapter). Shape is left null and picked
    // up the next time the repertoire loads via the existing lazy
    // `backfillShapes` in `repertoire-progress.ts` — the exact mechanism
    // already used for repertoires imported before shape caching existed.
    deferShape?: boolean;
  }
): Promise<{ repertoireId: string | null; error: string | null }> {
  let repId: string;
  let isNewRepertoire = false;

  if (params.existingRepertoireId) {
    repId = params.existingRepertoireId;
  } else {
    isNewRepertoire = true;
    const insertColumns: Record<string, unknown> = {
      player_id: params.playerId,
      name: params.name,
      color: params.color,
      eco_code: params.ecoCode,
      eco_name: params.ecoName
    };
    if (!params.deferShape) {
      // Computed from `params.moves` directly — before any DB writes — since
      // moves are immutable after import, this "shape" (see
      // `$lib/mastery/levelProgress.ts`) never changes again for this
      // repertoire once it's known to be complete (a single-chapter import,
      // or `importGames`, which always hands over every move up front).
      const dedupedMoves = Array.from(new Map(params.moves.map((m) => [`${m.fromFen}|${m.san}`, m])).values());
      const rawMoves: RawMoveRow[] = dedupedMoves.map((m, i) => ({
        id: String(i),
        fromPositionId: m.fromFen,
        toPositionId: m.toFen,
        fromFen: m.fromFen,
        toFen: m.toFen,
        san: m.san,
        isPlayerTurn: m.is_player_turn
      }));
      const shape = repertoireShape(enumerateVariations(rawMoves));
      insertColumns.total_variations = shape.totalVariations;
      insertColumns.total_levels = shape.totalLevels;
      insertColumns.level1_task_count = shape.level1TaskCount;
    }

    const { data: rep, error: repErr } = await supabase.from('repertoires').insert(insertColumns).select().single();
    if (repErr) return { repertoireId: null, error: repErr.message };
    repId = rep.id;
  }

  // Batch every write instead of doing 2 upserts + 2 selects + 1 upsert PER
  // MOVE (5 sequential round-trips each) — for a large multi-chapter study
  // that's easily thousands of round-trips, enough to blow past a request
  // timeout and leave a partially-imported repertoire behind. Chunking keeps
  // each request comfortably sized regardless of PGN size.
  const CHUNK = 500;
  const uniqueFens = Array.from(new Set(params.moves.flatMap((m) => [m.fromFen, m.toFen])));

  // Any write failure below leaves an already-inserted repertoire row with
  // no (or partial) moves — silently swallowing that error is what produces
  // a repertoire that looks imported but is actually empty. Roll back a
  // repertoire THIS call created; a pre-existing one (append mode) is left
  // alone — the client (see `PgnImportForm.svelte`) owns rolling back a
  // whole multi-chapter batch since it's the only party that knows every
  // chapter belongs to the same import.
  async function fail(message: string): Promise<{ repertoireId: string | null; error: string | null }> {
    if (isNewRepertoire) await supabase.from('repertoires').delete().eq('id', repId);
    return { repertoireId: null, error: message };
  }

  for (let i = 0; i < uniqueFens.length; i += CHUNK) {
    const chunk = uniqueFens.slice(i, i + CHUNK).map((fen) => ({ fen }));
    const { error } = await supabase.from('positions').upsert(chunk, { onConflict: 'fen', ignoreDuplicates: true });
    if (error) return fail(`Failed to save positions: ${error.message}`);
  }

  // `positions` only has INSERT/SELECT RLS policies (no UPDATE), so the id
  // lookup has to be a plain SELECT rather than an upsert-with-return. A GET
  // with every FEN in this chunk crammed into the query string can blow past
  // a proxy's URL-length limit — chunk by character budget, not row count,
  // since a fixed row count doesn't account for how long individual FENs are.
  // 6000 stays comfortably under typical proxy limits (~8KB) while cutting
  // round-trips ~4x vs. the previous 1500 budget — a large multi-chapter
  // import (thousands of unique positions) was serializing hundreds of tiny
  // sequential SELECTs here, the dominant cost in a slow import.
  const fenToId = new Map<string, string>();
  for (const chunk of chunkByLength(uniqueFens, 6000)) {
    const { data: rows, error } = await supabase.from('positions').select('id, fen').in('fen', chunk);
    if (error) return fail(`Failed to load positions: ${error.message}`);
    for (const row of rows ?? []) fenToId.set(row.fen, row.id);
  }

  const missingFens = uniqueFens.filter((fen) => !fenToId.has(fen));
  if (missingFens.length > 0) {
    return fail(`${missingFens.length} position(s) could not be saved — import aborted to avoid dropping moves silently.`);
  }

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
    annotation: move.annotation
  }));

  for (let i = 0; i < moveRows.length; i += CHUNK) {
    const chunk = moveRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('moves')
      .upsert(chunk, { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true });
    if (error) return fail(`Failed to save moves: ${error.message}`);
  }

  return { repertoireId: repId, error: null };
}
```

- [ ] **Step 2: Verify `importGames` still compiles unchanged**

`importGames` (same file, lines 38-55) calls `writeMoves` without `existingRepertoireId`/`deferShape` — both are optional, so it keeps today's exact behavior (new repertoire, eager shape computation). No change needed there.

- [ ] **Step 3: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (this file has no direct test; this confirms nothing else broke)

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/pgn-import.ts
git commit -m "feat: let writeMoves append to an existing repertoire instead of always creating one"
```

---

### Task 5: `/api/repertoires/import-chapter` — accept append parameters

**Files:**
- Modify: `src/routes/api/repertoires/import-chapter/+server.ts`

- [ ] **Step 1: Update the endpoint**

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
		(m.annotation === null || typeof m.annotation === 'string')
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
	const { name, color, ecoCode, ecoName, moves, existingRepertoireId, deferShape } = body ?? {};

	if (typeof name !== 'string' || !name.trim()) throw error(400, 'name is required');
	if (color !== 'white' && color !== 'black') throw error(400, 'color must be "white" or "black"');
	if (ecoCode !== null && typeof ecoCode !== 'string') throw error(400, 'ecoCode must be a string or null');
	if (ecoName !== null && typeof ecoName !== 'string') throw error(400, 'ecoName must be a string or null');
	if (!Array.isArray(moves) || !moves.every(isMoveRow)) throw error(400, 'moves must be an array of move rows');
	if (existingRepertoireId !== undefined && typeof existingRepertoireId !== 'string') {
		throw error(400, 'existingRepertoireId must be a string');
	}
	if (deferShape !== undefined && typeof deferShape !== 'boolean') {
		throw error(400, 'deferShape must be a boolean');
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
		deferShape
	});
	if (result.error) throw error(400, result.error);

	return json({ repertoireId: result.repertoireId });
};
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (no existing test covers this file directly; Task 6 adds coverage through the form)

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/repertoires/import-chapter/+server.ts
git commit -m "feat: let import-chapter endpoint append to an existing repertoire"
```

---

### Task 6: `PgnImportForm.svelte` — one repertoire per multi-chapter import

**Files:**
- Modify: `src/lib/components/PgnImportForm.svelte:40-103`
- Modify: `src/lib/components/PgnImportForm.test.ts`

- [ ] **Step 1: Update the two multi-chapter tests to expect one shared repertoire id**

In `src/lib/components/PgnImportForm.test.ts`, replace the `'imports a multi-game PGN one chapter at a time, showing per-chapter progress'` test with:

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
		expect(firstBody.existingRepertoireId).toBeUndefined();
		expect(firstBody.deferShape).toBe(true);
		expect(secondBody.name).toBe('My Study — Line B');
		expect(secondBody.existingRepertoireId).toBe('r1'); // appends onto chapter 1's repertoire
		expect(secondBody.deferShape).toBe(true);
	});
```

Replace the `'rolls back already-created chapters when a later one fails'` test with:

```ts
	it('rolls back the shared repertoire when a later chapter fails', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ repertoireId: 'r1' }) }) // chapter 1 succeeds
			.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'Failed to save moves: boom' }) }) // chapter 2 fails
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // the DELETE rollback call
		vi.stubGlobal('fetch', fetchSpy);

		const twoGames = '[Event "Line A"]\n\n1. e4 e5 *\n\n[Event "Line B"]\n\n1. d4 d5 *';
		fillBasicForm('My Study', twoGames);
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(screen.getByText('Failed to save moves: boom')).toBeTruthy());
		expect(gotoMock).not.toHaveBeenCalled();
		expect(fetchSpy).toHaveBeenCalledTimes(3);
		expect(fetchSpy.mock.calls[2][0]).toBe('/api/repertoires/r1'); // one DELETE for the one shared repertoire
		expect(fetchSpy.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
	});
```

Also add a test confirming the single-chapter path is untouched:

```ts
	it('does not defer shape or pass existingRepertoireId for a single-chapter import', async () => {
		render(PgnImportForm, { props: { submitLabel: 'Create Repertoire', redirectTo: '/repertoires' } });
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repertoireId: 'r1' }) });
		vi.stubGlobal('fetch', fetchSpy);

		fillBasicForm('My Rep', '1. e4 e5 *');
		await fireEvent.click(screen.getByRole('button', { name: 'Create Repertoire' }));

		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith('/repertoires'));
		const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
		expect(body.existingRepertoireId).toBeUndefined();
		expect(body.deferShape).toBeUndefined();
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/PgnImportForm.test.ts`
Expected: FAIL — current implementation always creates a new repertoire per chapter and rolls back an array of ids.

- [ ] **Step 3: Update `handleSubmit`**

In `src/lib/components/PgnImportForm.svelte`, replace the `handleSubmit` function (lines 40-103) with:

```ts
	/**
	 * Imports one chapter per request instead of one request doing every
	 * chapter before replying — the whole point being a real, per-chapter
	 * progress bar instead of the page just sitting there for a large
	 * multi-chapter PGN. Every chapter after the first passes
	 * `existingRepertoireId` so they all land in the SAME repertoire (see
	 * `writeMoves`) instead of each becoming its own. `deferShape: true` on
	 * every chapter of a multi-chapter import tells the server not to cache a
	 * shape computed from just that one chapter's moves — the repertoire's
	 * real shape is picked up lazily the first time it's loaded (see
	 * `repertoire-progress.ts`'s existing backfill mechanism).
	 *
	 * On failure, rolls back the one shared repertoire created so far (if
	 * any) — a multi-chapter import is all-or-nothing, matching the old
	 * single-request behavior's guarantee.
	 */
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';

		const trimmedName = name.trim();
		const trimmedPgn = pgnText.trim();
		if (!trimmedName || !trimmedPgn) {
			errorMessage = 'Name and PGN are required';
			return;
		}

		const plan = planMultiImport(trimmedPgn, color);
		if ('error' in plan) {
			errorMessage = plan.error;
			return;
		}

		importing = true;
		const isMultiChapter = plan.length > 1;
		chapters = plan.map((chapter) => ({
			name: isMultiChapter ? `${trimmedName} — ${chapter.name}` : trimmedName,
			status: 'pending' as ChapterStatus
		}));

		let sharedRepertoireId: string | null = null;
		for (let i = 0; i < plan.length; i++) {
			chapters[i].status = 'importing';
			try {
				const res = await fetch('/api/repertoires/import-chapter', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: chapters[i].name,
						color,
						ecoCode: plan[i].ecoCode,
						ecoName: plan[i].ecoName,
						moves: plan[i].moves,
						...(sharedRepertoireId ? { existingRepertoireId: sharedRepertoireId } : {}),
						...(isMultiChapter ? { deferShape: true } : {})
					})
				});
				if (!res.ok) {
					const body = await res.json().catch(() => null);
					throw new Error(body?.message ?? 'Import failed');
				}
				const { repertoireId } = await res.json();
				sharedRepertoireId = repertoireId;
				chapters[i].status = 'done';
			} catch (err) {
				chapters[i].status = 'error';
				errorMessage = err instanceof Error ? err.message : 'Import failed';
				if (sharedRepertoireId) await fetch(`/api/repertoires/${sharedRepertoireId}`, { method: 'DELETE' });
				importing = false;
				return;
			}
		}

		await goto(redirectTo);
	}
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
git commit -m "feat: merge multi-chapter PGN imports into one repertoire on the client"
```

---

### Task 7: `loadRepertoireVariations` — expose this player's exclusion set

**Files:**
- Modify: `src/lib/server/practice-repertoire.ts:79-119`

- [ ] **Step 1: Update the function**

Replace `loadRepertoireVariations` (lines 79-119) with:

```ts
/**
 * Loads a repertoire a player can access (owned or coach-assigned), its full
 * enumerated variations, and this player's own excluded-variation set — the
 * same authorization + move fetch every practice-mutating endpoint and the
 * detail page's load need. Authorization is enforced entirely by RLS
 * (`repertoires`' and `moves`' own- and assigned-read policies) — a row
 * simply won't come back for a caller who isn't allowed to see it.
 *
 * Deliberately returns the FULL variation set rather than filtering out
 * excluded ones itself — callers that build practice queues/levels should
 * filter via `filterVariations` before using them (see
 * `practice/[repertoire_id]/+page.server.ts` and the `/api/practice/*`
 * endpoints), while callers that need to show every variation with its
 * checked state (the Practice picker's expand-to-show-variations UI) need
 * the unfiltered list plus this set to annotate it.
 */
export async function loadRepertoireVariations(
	supabase: SupabaseClient,
	userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[]; excludedVariationKeys: Set<string> }> {
	const [{ data: repertoire }, rawMoves, { data: exclusions }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, practice_depth_levels')
			.eq('id', repertoireId)
			.maybeSingle(),
		fetchAllMoves(supabase, repertoireId),
		supabase
			.from('variation_practice_exclusions')
			.select('variation_key')
			.eq('player_id', userId)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = (rawMoves ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));

	return {
		repertoire: {
			id: repertoire.id,
			name: repertoire.name,
			color: repertoire.color,
			practiceDepthLevels: repertoire.practice_depth_levels
		},
		variations: enumerateVariations(moves),
		excludedVariationKeys: new Set((exclusions ?? []).map((row: any) => row.variation_key))
	};
}
```

Note the second parameter is renamed from `_userId` to `userId` (it's now actually used) — update the doc comment as shown above rather than leaving the old "unused now" note in place.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: FAIL — the four call sites (Task 8) still destructure only `{ repertoire, variations }` and pass the unfiltered `variations` straight into level-building logic; this is expected until Task 8 lands. `remainingPageRanges`'s own tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/practice-repertoire.ts
git commit -m "feat: have loadRepertoireVariations expose the caller's excluded-variation set"
```

---

### Task 8: Filter excluded variations out of every practice-mutating call site

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`
- Modify: `src/routes/api/practice/continue/+server.ts`
- Modify: `src/routes/api/practice/mistake/+server.ts`
- Modify: `src/routes/api/practice/attempt/+server.ts`

- [ ] **Step 1: Update the detail page load**

In `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`, add the import and filter:

```ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress, getLastReviewedAt } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { buildPracticeView } from '$lib/mastery/practice';
import { filterVariations } from '$lib/mastery/variations';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user!.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const maxLevel = repertoire.practiceDepthLevels;
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations, maxLevel);
	const { level, totalLevels } = repertoireProgress(variations, row, maxLevel);

	// A `?level=N` request only takes effect for a level strictly below the
	// active one (or any level up to totalLevels once mastered) — anything
	// else (the active level, a locked level, garbage input) is ignored and
	// the page falls back to normal training below. This means URL tampering
	// to peek at a locked level just does nothing, rather than erroring.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	// Only relevant once mastered (see the "Repertoire Mastered" screen's
	// maintenance-review control) — skip the extra round trip for every
	// other load, which is the overwhelmingly common case.
	const lastReviewedAt = level === 'mastered' ? await getLastReviewedAt(supabase, user!.id, repertoireId) : null;

	return { repertoire, lastReviewedAt, ...buildPracticeView(variations, row, reviewLevel, maxLevel) };
};
```

- [ ] **Step 2: Update `/api/practice/continue`**

In `src/routes/api/practice/continue/+server.ts`, change line 4 and the load line:

```ts
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { continueFromBranch } from '$lib/mastery/practice';
import { requireApiUser } from '$lib/server/auth';
import { filterVariations } from '$lib/mastery/variations';
```

```ts
	const { variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const result = continueFromBranch(variations, level, variationKey, afterPlayerMoveIndex);
```

- [ ] **Step 3: Update `/api/practice/mistake`**

In `src/routes/api/practice/mistake/+server.ts`, change line 4 and the load line:

```ts
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyPreviousLevelMistake } from '$lib/server/level-progress';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';
import { filterVariations } from '$lib/mastery/variations';
```

```ts
	const { repertoire, variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const maxLevel = repertoire.practiceDepthLevels;
```

- [ ] **Step 4: Update `/api/practice/attempt`**

In `src/routes/api/practice/attempt/+server.ts`, change line 4 and the load line:

```ts
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult } from '$lib/server/level-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';
import { filterVariations } from '$lib/mastery/variations';
```

```ts
	const { repertoire, variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const maxLevel = repertoire.practiceDepthLevels;
```

- [ ] **Step 5: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS with zero type errors

- [ ] **Step 6: Commit**

```bash
git add src/routes/\(player\)/practice/\[repertoire_id\]/+page.server.ts src/routes/api/practice/continue/+server.ts src/routes/api/practice/mistake/+server.ts src/routes/api/practice/attempt/+server.ts
git commit -m "feat: exclude a player's unchecked variations from practice level-building"
```

---

### Task 9: Server module for reading/writing exclusion state

**Files:**
- Create: `src/lib/server/variation-practice-settings.ts`

No dedicated test file — thin Supabase I/O wrapper, per this repo's `src/lib/server/` convention.

- [ ] **Step 1: Write the module**

```ts
// mychess/src/lib/server/variation-practice-settings.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sets whether `variationKeys` are included in practice for `playerId`,
 * within `repertoireId`. `included: true` deletes any existing exclusion
 * rows (back to the default "included"); `included: false` upserts one
 * exclusion row per key. No-ops on an empty `variationKeys` array.
 */
export async function setVariationsIncluded(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKeys: string[],
	included: boolean
): Promise<{ error: string | null }> {
	if (variationKeys.length === 0) return { error: null };

	if (included) {
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.delete()
			.eq('player_id', playerId)
			.in('variation_key', variationKeys);
		return { error: error?.message ?? null };
	}

	const rows = variationKeys.map((variationKey) => ({
		player_id: playerId,
		repertoire_id: repertoireId,
		variation_key: variationKey
	}));
	const { error } = await supabase
		.from('variation_practice_exclusions')
		.upsert(rows, { onConflict: 'player_id,variation_key' });
	return { error: error?.message ?? null };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/variation-practice-settings.ts
git commit -m "feat: add setVariationsIncluded server helper"
```

---

### Task 10: New endpoints — list variations and toggle exclusions

**Files:**
- Create: `src/routes/api/repertoires/[id]/variations/+server.ts`
- Create: `src/routes/api/repertoires/[id]/exclusions/+server.ts`

- [ ] **Step 1: Write the GET endpoint**

```ts
// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state — powers the Practice picker's
 * expand-to-show-variations checkbox list. Fetched lazily (only when a
 * repertoire row is expanded), not eagerly for every repertoire on the
 * picker, to avoid re-introducing the full-move-fetch cost the shape cache
 * (see `repertoire-progress.ts`) exists specifically to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const { variations, excludedVariationKeys } = await loadRepertoireVariations(locals.supabase, user.id, params.id);

	return json(
		variations.map((v) => ({
			variationKey: v.variationKey,
			label: moveSequenceLabel(v.path),
			included: !excludedVariationKeys.has(v.variationKey)
		}))
	);
};
```

- [ ] **Step 2: Write the POST (toggle) endpoint**

```ts
// mychess/src/routes/api/repertoires/[id]/exclusions/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { setVariationsIncluded } from '$lib/server/variation-practice-settings';

/**
 * Sets whether one or more variations are included in practice for the
 * caller. Used both for a single variation's own checkbox and for the
 * repertoire-level checkbox's bulk include/exclude-all action (see
 * `RepertoirePracticeRow.svelte`) — same shape either way, just a longer
 * `variationKeys` array.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireApiUser(locals);
	const body = await request.json().catch(() => null);
	const { variationKeys, included } = body ?? {};

	if (!Array.isArray(variationKeys) || !variationKeys.every((k) => typeof k === 'string')) {
		throw error(400, 'variationKeys must be an array of strings');
	}
	if (typeof included !== 'boolean') throw error(400, 'included must be a boolean');

	const result = await setVariationsIncluded(locals.supabase, user.id, params.id, variationKeys, included);
	if (result.error) throw error(400, result.error);

	return json({ ok: true });
};
```

- [ ] **Step 3: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/repertoires/\[id\]/variations/+server.ts src/routes/api/repertoires/\[id\]/exclusions/+server.ts
git commit -m "feat: add endpoints to list a repertoire's variations and toggle their inclusion"
```

---

### Task 11: `repertoire-progress.ts` — exclusion-aware picker summaries

**Files:**
- Modify: `src/lib/server/repertoire-progress.ts`

- [ ] **Step 1: Update the module**

Replace the whole file with:

```ts
// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, filterVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';
import {
	repertoireProgressFromShape,
	repertoireShape,
	type RepertoireProgress,
	type RepertoireShape,
	type LevelProgressRow
} from '$lib/mastery/levelProgress';
import { remainingPageRanges } from './practice-repertoire';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
	// The repertoire's TRUE variation count, ignoring this player's
	// exclusions — together with `excludedVariationCount`, lets the Practice
	// picker show a repertoire-level checkbox's checked/unchecked/
	// indeterminate state without fetching every variation up front (only
	// needed once the row is actually expanded — see
	// `RepertoirePracticeRow.svelte`). `totalVariations` (from
	// `RepertoireProgress`) is the FILTERED count used for level/mastery math.
	fullVariationCount: number;
	excludedVariationCount: number;
};

// Supabase/PostgREST caps an unbounded select at `max_rows` (1000, see
// supabase/config.toml) and truncates silently past that — no error, just
// fewer rows than actually exist. `.order` makes the pagination
// deterministic — `.range` alone has no defined traversal order to page
// through without it. Pages beyond the first are fetched concurrently (see
// `remainingPageRanges`, shared with `practice-repertoire.ts`) rather than
// one at a time.
//
// Used both for the lazy shape backfill (repertoires imported before
// `writeMoves` started caching shape at import time) and for repertoires
// this player has excluded at least one variation from, where the cached
// whole-repertoire shape can't be trusted for THIS player's filtered view.
const MOVES_PAGE_SIZE = 1000;

async function fetchAllMoves(supabase: SupabaseClient, repIds: string[]): Promise<any[]> {
	const query = () =>
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds)
			.order('id', { ascending: true });

	const { data: firstPage, error: err } = await query().range(0, MOVES_PAGE_SIZE - 1);
	if (err) throw err;
	const firstRows = firstPage ?? [];
	if (firstRows.length < MOVES_PAGE_SIZE) return firstRows;

	const { count, error: countErr } = await supabase
		.from('moves')
		.select('id', { count: 'exact', head: true })
		.in('repertoire_id', repIds);
	if (countErr) throw countErr;

	const pages = await Promise.all(
		remainingPageRanges(count ?? firstRows.length, MOVES_PAGE_SIZE).map(([from, to]) => query().range(from, to))
	);
	for (const page of pages) {
		if (page.error) throw page.error;
	}

	return [...firstRows, ...pages.flatMap((p) => p.data ?? [])];
}

async function fetchExclusionsByRepertoire(
	supabase: SupabaseClient,
	playerId: string,
	repIds: string[]
): Promise<Map<string, Set<string>>> {
	const { data, error } = await supabase
		.from('variation_practice_exclusions')
		.select('repertoire_id, variation_key')
		.eq('player_id', playerId)
		.in('repertoire_id', repIds);
	if (error) throw error;

	const map = new Map<string, Set<string>>();
	for (const row of (data ?? []) as any[]) {
		const set = map.get(row.repertoire_id) ?? new Set<string>();
		set.add(row.variation_key);
		map.set(row.repertoire_id, set);
	}
	return map;
}

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count. Read-only from the caller's
 * perspective — doesn't reconcile or create `level_progress` rows (that's
 * the detail page's job via `loadSyncedLevelProgress`); a repertoire with no
 * row yet just shows the bootstrap "fresh Level 1" default. (It does write
 * the one-time shape backfill below, an implementation detail invisible to
 * callers — the return value is unaffected either way.)
 *
 * Reads the shape (`total_variations`/`total_levels`/`level1_task_count`)
 * cached on `repertoires` at import time instead of fetching every move row
 * and re-walking the variation tree on every load — moves are immutable
 * after import, so that shape is valid forever once computed. Two cases
 * still need a live move fetch: repertoires imported before this cache
 * existed (`total_variations` still null — backfilled here, same as before),
 * and repertoires this player has excluded at least one variation from,
 * where the cached shape reflects the WHOLE repertoire, not this player's
 * filtered view of it. The cache itself is never overwritten by exclusions —
 * it stays the true full-repertoire shape for every other viewer.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, total_variations, total_levels, level1_task_count, practice_depth_levels')
			.eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select(
				'repertoire:repertoire_id(id, name, color, total_variations, total_levels, level1_task_count, practice_depth_levels)'
			)
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const uncachedIds = allReps.filter((r: any) => r.total_variations === null).map((r: any) => r.id);

	const exclusionsByRep = await fetchExclusionsByRepertoire(supabase, userId, repIds);
	const excludedIds = [...exclusionsByRep.keys()];
	const needsMoveFetchIds = Array.from(new Set([...uncachedIds, ...excludedIds]));

	const [{ data: progressRows }, rawMoves] = await Promise.all([
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue')
			.eq('player_id', userId)
			.in('repertoire_id', repIds),
		needsMoveFetchIds.length > 0 ? fetchAllMoves(supabase, needsMoveFetchIds) : Promise.resolve([])
	]);

	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of rawMoves as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}
	const variationsByRep = new Map<string, Variation[]>();
	for (const repId of needsMoveFetchIds) {
		variationsByRep.set(repId, enumerateVariations(movesByRep.get(repId) ?? []));
	}

	// Self-healing, same as before: only ever runs once per repertoire, since
	// every subsequent load finds the columns already populated.
	const backfilledShapes = new Map<string, RepertoireShape>();
	await Promise.all(
		uncachedIds.map(async (repId) => {
			const shape = repertoireShape(variationsByRep.get(repId) ?? []);
			backfilledShapes.set(repId, shape);
			const { error } = await supabase
				.from('repertoires')
				.update({
					total_variations: shape.totalVariations,
					total_levels: shape.totalLevels,
					level1_task_count: shape.level1TaskCount
				})
				.eq('id', repId);
			if (error) console.error(`Failed to backfill shape cache for repertoire ${repId}:`, error);
		})
	);

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue });
	}

	return allReps.map((r: any) => {
		const naturalShape: RepertoireShape =
			r.total_variations !== null
				? { totalVariations: r.total_variations, totalLevels: r.total_levels, level1TaskCount: r.level1_task_count }
				: backfilledShapes.get(r.id)!;

		const excluded = exclusionsByRep.get(r.id);
		const effectiveShape =
			excluded && excluded.size > 0
				? repertoireShape(filterVariations(variationsByRep.get(r.id) ?? [], excluded))
				: naturalShape;

		// Clamped to the player's configured practice depth, same as the
		// detail page (`effectiveLevelCap`) — otherwise this would show a
		// level count deeper than what practice will actually ever ask for.
		const shape: RepertoireShape = {
			...effectiveShape,
			totalLevels: Math.min(effectiveShape.totalLevels, r.practice_depth_levels)
		};
		const progress = repertoireProgressFromShape(shape, rowByRep.get(r.id) ?? null);
		return {
			id: r.id,
			name: r.name,
			color: r.color,
			...progress,
			fullVariationCount: naturalShape.totalVariations,
			excludedVariationCount: excluded?.size ?? 0
		};
	});
}
```

- [ ] **Step 2: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/repertoire-progress.ts
git commit -m "feat: make picker summaries reflect a player's excluded variations"
```

---

### Task 12: `RepertoirePracticeRow.svelte` — collapsible row with checkboxes

**Files:**
- Create: `src/lib/components/RepertoirePracticeRow.svelte`
- Create: `src/lib/components/RepertoirePracticeRow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment jsdom
// mychess/src/lib/components/RepertoirePracticeRow.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import RepertoirePracticeRow from './RepertoirePracticeRow.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const baseRep = {
	id: 'rep-1',
	name: 'Ruy Lopez',
	color: 'white',
	level: 3 as const,
	totalLevels: 6,
	levelTaskCount: 18,
	levelSolvedCount: 12,
	fullVariationCount: 2,
	excludedVariationCount: 0
};

const variationsResponse = [
	{ variationKey: 'v1', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6', included: true },
	{ variationKey: 'v2', label: '1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6', included: true }
];

describe('RepertoirePracticeRow', () => {
	it('renders collapsed by default, showing name and progress but no variations', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		expect(screen.getByText('Ruy Lopez')).toBeTruthy();
		expect(screen.queryByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeNull();
	});

	it('shows the parent checkbox as checked when nothing is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: baseRep } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.checked).toBe(true);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('shows the parent checkbox as indeterminate when some variations are excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 1 } } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.indeterminate).toBe(true);
	});

	it('shows the parent checkbox as unchecked when every variation is excluded', () => {
		render(RepertoirePracticeRow, { props: { rep: { ...baseRep, excludedVariationCount: 2 } } });
		const checkbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		expect(checkbox.indeterminate).toBe(false);
	});

	it('fetches and shows variations when expanded, only once', async () => {
		const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => variationsResponse });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => expect(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6')).toBeTruthy());
		expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/variations');

		await fireEvent.click(screen.getByLabelText('Collapse Ruy Lopez'));
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		expect(fetchSpy).toHaveBeenCalledTimes(1); // cached after the first fetch
	});

	it('toggling one variation checkbox posts its own exclusion change', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6'));

		const variationCheckbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
		await fireEvent.click(variationCheckbox);

		await waitFor(() =>
			expect(fetchSpy).toHaveBeenCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: false })
			})
		);
	});

	it('unchecking the parent excludes every variation, and re-checking restores the prior selection', async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => variationsResponse }) // GET on expand
			.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); // every POST after
		vi.stubGlobal('fetch', fetchSpy);
		render(RepertoirePracticeRow, { props: { rep: baseRep } });

		// Individually uncheck v2 first, so the "restore" below has something
		// meaningful to prove: it must restore v1 only, not both.
		await fireEvent.click(screen.getByLabelText('Expand Ruy Lopez'));
		await waitFor(() => screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6'));
		const v2Checkbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
		await fireEvent.click(v2Checkbox);
		await waitFor(() => expect(v2Checkbox.checked).toBe(false));

		const parentCheckbox = screen.getByRole('checkbox', { name: /Ruy Lopez/ }) as HTMLInputElement;
		await fireEvent.click(parentCheckbox); // bulk uncheck (only v1 was still included)
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: false })
			})
		);
		const v1Checkbox = within(screen.getByText('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6').closest('label')!).getByRole(
			'checkbox'
		) as HTMLInputElement;
		expect(v1Checkbox.checked).toBe(false);

		await fireEvent.click(parentCheckbox); // re-check — restores exactly v1, not v2
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenLastCalledWith('/api/repertoires/rep-1/exclusions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ variationKeys: ['v1'], included: true })
			})
		);
		expect(v1Checkbox.checked).toBe(true);
		expect(v2Checkbox.checked).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/RepertoirePracticeRow.test.ts`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 3: Implement the component**

```svelte
<!-- mychess/src/lib/components/RepertoirePracticeRow.svelte -->
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
		fullVariationCount: number;
		excludedVariationCount: number;
	};
	type VariationRow = { variationKey: string; label: string; included: boolean };

	let { rep }: { rep: RepSummary } = $props();

	let expanded = $state(false);
	let variations = $state<VariationRow[] | null>(null);
	let loadingVariations = $state(false);
	// The set of variationKeys that were included right before the parent
	// checkbox last bulk-excluded everything — lets re-checking the parent
	// restore exactly that selection instead of blanket-including everything.
	let uncheckSnapshot = $state<Set<string> | null>(null);

	const checkedCount = $derived(
		variations ? variations.filter((v) => v.included).length : rep.fullVariationCount - rep.excludedVariationCount
	);
	const totalCount = $derived(variations ? variations.length : rep.fullVariationCount);
	const parentState = $derived<'checked' | 'unchecked' | 'indeterminate'>(
		totalCount === 0 || checkedCount === totalCount ? 'checked' : checkedCount === 0 ? 'unchecked' : 'indeterminate'
	);

	function indeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(newValue: boolean) {
				node.indeterminate = newValue;
			}
		};
	}

	async function ensureVariationsLoaded(): Promise<VariationRow[]> {
		if (variations) return variations;
		loadingVariations = true;
		try {
			const res = await fetch(`/api/repertoires/${rep.id}/variations`);
			const data = (await res.json()) as VariationRow[];
			variations = data;
			return data;
		} finally {
			loadingVariations = false;
		}
	}

	async function toggleExpanded() {
		expanded = !expanded;
		if (expanded) await ensureVariationsLoaded();
	}

	async function postExclusion(variationKeys: string[], included: boolean) {
		await fetch(`/api/repertoires/${rep.id}/exclusions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ variationKeys, included })
		});
	}

	async function toggleVariation(key: string) {
		const list = await ensureVariationsLoaded();
		const target = list.find((v) => v.variationKey === key);
		if (!target) return;
		const nextIncluded = !target.included;
		variations = list.map((v) => (v.variationKey === key ? { ...v, included: nextIncluded } : v));
		await postExclusion([key], nextIncluded);
	}

	async function toggleParent() {
		const list = await ensureVariationsLoaded();

		if (parentState !== 'unchecked') {
			// Checked or indeterminate -> bulk-exclude everything, remembering
			// exactly which ones were included so a re-check can restore them.
			// Only the currently-included keys are posted — an already-excluded
			// variation doesn't need a redundant write.
			const included = list.filter((v) => v.included).map((v) => v.variationKey);
			uncheckSnapshot = new Set(included);
			variations = list.map((v) => ({ ...v, included: false }));
			await postExclusion(included, false);
			return;
		}

		// Unchecked -> restore the pre-uncheck selection if we have one from
		// this visit, otherwise default to including everything.
		const toInclude = uncheckSnapshot ?? new Set(list.map((v) => v.variationKey));
		variations = list.map((v) => ({ ...v, included: toInclude.has(v.variationKey) }));
		uncheckSnapshot = null;
		await postExclusion([...toInclude], true);
	}
</script>

<li class="bg-white rounded-xl border border-gray-200 shadow-sm">
	<div class="flex items-center gap-3 p-4">
		<label class="flex items-center shrink-0">
			<input
				type="checkbox"
				checked={parentState === 'checked'}
				use:indeterminate={parentState === 'indeterminate'}
				onchange={toggleParent}
				aria-label={rep.name}
			/>
		</label>
		<button
			type="button"
			onclick={toggleExpanded}
			aria-label={expanded ? `Collapse ${rep.name}` : `Expand ${rep.name}`}
			class="text-gray-400 shrink-0 w-4"
		>
			{expanded ? '▾' : '▸'}
		</button>
		<a href="/practice/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
			<span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color === 'black' ? '#1f2937' : '#e5e7eb'}"
			></span>
			<div class="flex-1 min-w-0">
				<h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
				<p class="text-sm text-gray-400">
					{#if rep.fullVariationCount === 0}
						No moves yet
					{:else if rep.level === 'mastered'}
						🏆 Mastered · {levelTag(rep.totalLevels, rep.totalLevels)}
					{:else}
						Level {rep.level} of {rep.totalLevels} · {levelTag(rep.level, rep.totalLevels)} · {rep.levelSolvedCount}/{rep.levelTaskCount}
						solved
					{/if}
				</p>
			</div>
			<span class="text-gray-400 text-sm">→</span>
		</a>
	</div>

	{#if expanded}
		<ul class="pl-14 pr-4 pb-3 space-y-1">
			{#if loadingVariations}
				<li class="text-sm text-gray-400">Loading variations…</li>
			{:else}
				{#each variations ?? [] as variation (variation.variationKey)}
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
		</ul>
	{/if}
</li>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/RepertoirePracticeRow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/RepertoirePracticeRow.svelte src/lib/components/RepertoirePracticeRow.test.ts
git commit -m "feat: add collapsible repertoire/variations row with practice checkboxes"
```

---

### Task 13: `practice/+page.svelte` — use the new hierarchical row

**Files:**
- Modify: `src/routes/(player)/practice/+page.svelte`

- [ ] **Step 1: Replace the flat list with `RepertoirePracticeRow`**

```svelte
<script lang="ts">
  import RepertoirePracticeRow from '$lib/components/RepertoirePracticeRow.svelte';

  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>

<svelte:head>
  <title>Practice Your Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6">
    <h1 class="text-2xl font-bold text-gray-900 mb-4">Practice Your Repertoires</h1>

    {#if data.repertoires.length === 0}
      <div class="text-center py-16 text-gray-400">
        <p class="text-4xl mb-4">📚</p>
        <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
        <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.repertoires as rep (rep.id)}
          <RepertoirePracticeRow {rep} />
        {/each}
      </ul>
    {/if}
  </div>
</main>
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in, visit `/practice` with at least one repertoire that has 2+ variations. Confirm:
- The row is collapsed by default with a checked checkbox.
- Expanding shows each variation's move-sequence label with its own checkbox.
- Unchecking a variation persists (reload the page — it should stay unchecked).
- Unchecking the parent unchecks every variation; re-checking it restores the prior per-variation state.
- Clicking the repertoire name still navigates to `/practice/[id]` and starts a session.

- [ ] **Step 3: Run the full test suite and type check**

Run: `npx vitest run && npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(player)/practice/+page.svelte"
git commit -m "feat: show a collapsible repertoire/variations checkbox list on the Practice picker"
```

---

### Task 14: Migration script — merge already-split repertoires

**Files:**
- Create: `scripts/merge-split-repertoires.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```ts
// mychess/scripts/merge-split-repertoires.ts
import { createClient } from '@supabase/supabase-js';
import { planRepertoireMerges } from '../src/lib/repertoire-merge';
import { enumerateVariations, type RawMoveRow } from '../src/lib/mastery/variations';
import { repertoireShape } from '../src/lib/mastery/levelProgress';

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	process.exit(1);
}

const db = createClient(url, key);

async function fetchAllMovesForRepertoire(repertoireId: string): Promise<RawMoveRow[]> {
	const { data, error } = await db
		.from('moves')
		.select('id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)')
		.eq('repertoire_id', repertoireId);
	if (error) throw error;
	return (data ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));
}

/**
 * Re-parents every move of `duplicateIds` onto `canonicalId`. Where a moved
 * edge collides with one the canonical repertoire already has (same
 * (repertoire_id, from_position, san) — a real unique constraint violation,
 * Postgres code 23505), the duplicate edge is dropped instead of merged:
 * accepted trade-off, see the design doc — any progress tied to that
 * specific dropped move id resets.
 */
async function mergeGroup(canonicalId: string, duplicateIds: string[]): Promise<void> {
	for (const dupId of duplicateIds) {
		const { data: dupMoves, error: fetchErr } = await db.from('moves').select('id').eq('repertoire_id', dupId);
		if (fetchErr) throw fetchErr;

		for (const move of dupMoves ?? []) {
			const { error: updateErr } = await db.from('moves').update({ repertoire_id: canonicalId }).eq('id', move.id);
			if (updateErr) {
				if (updateErr.code === '23505') {
					const { error: deleteErr } = await db.from('moves').delete().eq('id', move.id);
					if (deleteErr) throw deleteErr;
					continue;
				}
				throw updateErr;
			}
		}

		const { error: deleteRepErr } = await db.from('repertoires').delete().eq('id', dupId);
		if (deleteRepErr) throw deleteRepErr;
		console.log(`Merged repertoire ${dupId} into ${canonicalId}`);
	}

	const mergedMoves = await fetchAllMovesForRepertoire(canonicalId);
	const shape = repertoireShape(enumerateVariations(mergedMoves));
	const { error: shapeErr } = await db
		.from('repertoires')
		.update({
			total_variations: shape.totalVariations,
			total_levels: shape.totalLevels,
			level1_task_count: shape.level1TaskCount
		})
		.eq('id', canonicalId);
	if (shapeErr) throw shapeErr;
	console.log(`Recomputed shape for ${canonicalId}: ${JSON.stringify(shape)}`);
}

async function main() {
	const { data: repertoires, error } = await db.from('repertoires').select('id, player_id, color, name, created_at');
	if (error) throw error;

	const candidates = (repertoires ?? []).map((r: any) => ({
		id: r.id,
		playerId: r.player_id,
		color: r.color,
		name: r.name,
		createdAt: r.created_at
	}));

	const merges = planRepertoireMerges(candidates);
	if (merges.length === 0) {
		console.log('No split repertoires found — nothing to merge.');
		return;
	}

	console.log(`Found ${merges.length} group(s) to merge.`);
	for (const group of merges) {
		await mergeGroup(group.canonicalId, group.duplicateIds);
	}
	console.log('Done.');
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error('Merge failed:', e);
		process.exit(1);
	});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (after `"eco:generate"`):

```json
		"merge-repertoires": "tsx scripts/merge-split-repertoires.ts"
```

- [ ] **Step 3: Hand off to the user**

This script mutates production data with the service-role key and cannot be run by Claude (no working service-role key in this environment, per `CLAUDE.md`). Tell the user to run `npm run merge-repertoires` themselves (with `PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set) once Task 1's migration has landed and Tasks 4-6 (the import fix) are deployed, and to confirm the output before considering already-split repertoires merged.

- [ ] **Step 4: Commit**

```bash
git add scripts/merge-split-repertoires.ts package.json
git commit -m "feat: add one-off script to merge already-split repertoires"
```

---

### Task 15: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every file touched in Tasks 1-14.

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: zero errors (per `CLAUDE.md`, this is the hard gate before pushing to `main`).

- [ ] **Step 3: Manually verify the import fix end-to-end**

With `npm run dev` running: import a PGN with 3+ games sharing an opening (e.g. three `[Event "..."]` blocks each starting `1. e4 e5 2. Nf3`), confirm:
- The Repertoires list (`/repertoires`) shows exactly ONE new repertoire, not three.
- The Practice picker (`/practice`) shows that repertoire with `fullVariationCount` matching the number of distinct lines imported.
- Expanding it on the picker lists each imported line as a separate variation with a correct move-sequence label.

- [ ] **Step 4: Manually verify the migration script against real data (if any split repertoires exist)**

If the user has existing multi-chapter imports already split into separate repertoires, have them run `npm run merge-repertoires` (Task 14) and confirm in the UI that they collapse into one repertoire with the expected variations.

- [ ] **Step 5: Refactor pass**

Per `CLAUDE.md`'s "after finishing a major feature" convention: re-read every file touched in Tasks 1-14 for duplicated logic, dead code, or drift from the pure-logic-in-`lib`/I-O-in-`lib/server` split. Fix anything cheap inline; file a GitHub issue (`gh issue create`) for anything bigger.

- [ ] **Step 6: Push**

```bash
git push
```

(Per this repo's convention — production is the test environment and there are no other users yet — push directly to `main` without asking first, per `CLAUDE.md`.)

---

## Post-plan reminders

- Task 1's migration and Task 14's merge script both require the user to take a manual action outside this plan's control (running SQL in the Supabase dashboard; running a script with the service-role key). Do not mark the overall feature done until the user has confirmed both.
- The GitHub issue (#51) should be closed (`gh issue close 51`) once Task 15 is complete and pushed.
