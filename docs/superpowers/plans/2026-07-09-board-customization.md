# Board Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick board color theme, piece set, animation speed, coordinates and last-move highlight, persist the choice to their Supabase profile, and apply it to every board in the app.

**Architecture:** A single `board_prefs jsonb` column on `profiles` holds the choice. Pure, unit-tested logic in `src/lib/board/prefs.ts` defines catalogs/defaults and validates the stored blob. Global CSS (scoped under wrapper classes) supplies the extra board themes and piece sets on top of chessground's default brown/cburnett. `ChessBoard.svelte` takes an optional `prefs` prop and applies wrapper classes + chessground config. Prefs load server-side through the `(player)` layout so boards render correctly on first paint. A Board section in the existing settings route edits and saves them.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, chessground 9.2.1, chess.js, Supabase (Postgres + `@supabase/ssr`), Tailwind 4, vitest.

---

## File structure

**New**
- `mychess/supabase/migrations/0024_board_prefs.sql` — add the column
- `mychess/src/lib/board/prefs.ts` — pure logic: types, catalogs, defaults, `parseBoardPrefs`, `animationDuration`
- `mychess/src/lib/board/prefs.test.ts` — unit tests for the above
- `mychess/src/lib/board/board-themes.css` — scoped `cg-board` backgrounds for the 4 themes
- `mychess/src/lib/board/pieces.css` — scoped piece backgrounds for merida + alpha
- `mychess/static/pieces/{merida,alpha}/*.svg` — piece art (downloaded, GPL)
- `mychess/static/pieces/LICENSE` — GPL attribution for the bundled piece art

**Modified**
- `mychess/src/app.css` — import the two new stylesheets
- `mychess/src/lib/components/ChessBoard.svelte` — `prefs` prop + wrapper classes + config wiring
- `mychess/src/routes/(player)/+layout.server.ts` — return parsed `boardPrefs`
- `mychess/src/routes/(player)/settings/+page.server.ts` — `save_board_prefs` action
- `mychess/src/routes/(player)/settings/+page.svelte` — Board customization section + live preview
- `mychess/src/routes/(player)/drill/+page.svelte` — pass `prefs={data.boardPrefs}`
- `mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte` — pass `prefs={data.boardPrefs}`
- `mychess/src/routes/(player)/practice/+page.svelte` — pass `prefs={data.boardPrefs}`
- `mychess/src/routes/(player)/time-trial/+page.svelte` — pass `prefs={data.boardPrefs}`

All `npm`/`npx` commands run from the `mychess/` app directory.

---

## Task 1: Migration for `board_prefs`

**Files:**
- Create: `mychess/supabase/migrations/0024_board_prefs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0024_board_prefs.sql
-- Per-user chess board appearance preferences (theme, piece set, animation,
-- coordinates, last-move highlight). Missing keys are filled with defaults in
-- application code (see src/lib/board/prefs.ts), so an empty object is valid.
alter table profiles
  add column if not exists board_prefs jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add mychess/supabase/migrations/0024_board_prefs.sql
git commit -m "feat: migration adding profiles.board_prefs"
```

- [ ] **Step 3: Hand off to the user to apply**

This environment cannot apply migrations. Paste the file contents and ask the user to run it in the Supabase SQL editor (or trigger `migrate.yml`). Ask them to confirm the `profiles.board_prefs` column exists before relying on persistence in Task 7's manual check. The rest of the plan (pure logic, CSS, component) does not require the column to exist yet.

---

## Task 2: Pure prefs logic (TDD)

**Files:**
- Create: `mychess/src/lib/board/prefs.ts`
- Test: `mychess/src/lib/board/prefs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mychess/src/lib/board/prefs.test.ts
import { describe, it, expect } from 'vitest';
import {
	parseBoardPrefs,
	animationDuration,
	DEFAULT_PREFS,
	BOARD_THEMES,
	PIECE_SETS,
	ANIMATION_SPEEDS
} from './prefs';

describe('parseBoardPrefs', () => {
	it('returns defaults for an empty object', () => {
		expect(parseBoardPrefs({})).toEqual(DEFAULT_PREFS);
	});

	it('returns defaults for non-object input', () => {
		for (const bad of [null, undefined, 'x', 42, true, []]) {
			expect(parseBoardPrefs(bad)).toEqual(DEFAULT_PREFS);
		}
	});

	it('merges a valid partial object over defaults', () => {
		expect(parseBoardPrefs({ theme: 'green', coordinates: false })).toEqual({
			...DEFAULT_PREFS,
			theme: 'green',
			coordinates: false
		});
	});

	it('falls back per-key for unknown enum values', () => {
		const r = parseBoardPrefs({ theme: 'polkadot', pieceSet: 'nope', animation: 'warp' });
		expect(r.theme).toBe(DEFAULT_PREFS.theme);
		expect(r.pieceSet).toBe(DEFAULT_PREFS.pieceSet);
		expect(r.animation).toBe(DEFAULT_PREFS.animation);
	});

	it('falls back for non-boolean toggle values', () => {
		const r = parseBoardPrefs({ coordinates: 'yes', highlight: 1 });
		expect(r.coordinates).toBe(DEFAULT_PREFS.coordinates);
		expect(r.highlight).toBe(DEFAULT_PREFS.highlight);
	});

	it('accepts every catalog value as valid', () => {
		for (const t of BOARD_THEMES) expect(parseBoardPrefs({ theme: t.id }).theme).toBe(t.id);
		for (const p of PIECE_SETS) expect(parseBoardPrefs({ pieceSet: p.id }).pieceSet).toBe(p.id);
		for (const a of ANIMATION_SPEEDS)
			expect(parseBoardPrefs({ animation: a.id }).animation).toBe(a.id);
	});
});

describe('animationDuration', () => {
	it('maps speeds to milliseconds', () => {
		expect(animationDuration('off')).toBe(0);
		expect(animationDuration('subtle')).toBe(200);
		expect(animationDuration('snappy')).toBe(120);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/board/prefs.test.ts`
Expected: FAIL — cannot resolve `./prefs`.

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/board/prefs.ts
export type BoardTheme = 'brown' | 'green' | 'blue' | 'midnight';
export type PieceSet = 'cburnett' | 'merida' | 'alpha';
export type AnimationSpeed = 'off' | 'subtle' | 'snappy';

export interface BoardPrefs {
	theme: BoardTheme;
	pieceSet: PieceSet;
	animation: AnimationSpeed;
	coordinates: boolean;
	highlight: boolean;
}

export const BOARD_THEMES: { id: BoardTheme; label: string; light: string; dark: string }[] = [
	{ id: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
	{ id: 'green', label: 'Green', light: '#ebecd0', dark: '#779556' },
	{ id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
	{ id: 'midnight', label: 'Midnight', light: '#6b7a8f', dark: '#3b4657' }
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
	{ id: 'cburnett', label: 'Cburnett' },
	{ id: 'merida', label: 'Merida' },
	{ id: 'alpha', label: 'Alpha' }
];

export const ANIMATION_SPEEDS: { id: AnimationSpeed; label: string; durationMs: number }[] = [
	{ id: 'off', label: 'Off', durationMs: 0 },
	{ id: 'subtle', label: 'Subtle', durationMs: 200 },
	{ id: 'snappy', label: 'Snappy', durationMs: 120 }
];

export const DEFAULT_PREFS: BoardPrefs = {
	theme: 'brown',
	pieceSet: 'cburnett',
	animation: 'subtle',
	coordinates: true,
	highlight: true
};

function pick<T extends string>(val: unknown, allowed: readonly T[], fallback: T): T {
	return typeof val === 'string' && (allowed as readonly string[]).includes(val)
		? (val as T)
		: fallback;
}

function bool(val: unknown, fallback: boolean): boolean {
	return typeof val === 'boolean' ? val : fallback;
}

export function parseBoardPrefs(raw: unknown): BoardPrefs {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PREFS };
	const r = raw as Record<string, unknown>;
	return {
		theme: pick(r.theme, BOARD_THEMES.map((t) => t.id), DEFAULT_PREFS.theme),
		pieceSet: pick(r.pieceSet, PIECE_SETS.map((p) => p.id), DEFAULT_PREFS.pieceSet),
		animation: pick(r.animation, ANIMATION_SPEEDS.map((a) => a.id), DEFAULT_PREFS.animation),
		coordinates: bool(r.coordinates, DEFAULT_PREFS.coordinates),
		highlight: bool(r.highlight, DEFAULT_PREFS.highlight)
	};
}

export function animationDuration(speed: AnimationSpeed): number {
	return ANIMATION_SPEEDS.find((a) => a.id === speed)?.durationMs ?? 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/board/prefs.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/board/prefs.ts mychess/src/lib/board/prefs.test.ts
git commit -m "feat: board prefs catalog + validator"
```

---

## Task 3: Board theme CSS

**Files:**
- Create: `mychess/src/lib/board/board-themes.css`
- Modify: `mychess/src/app.css`

Mechanism: chessground draws the board as a `cg-board` background and the
interactive square colors (move-dest, last-move, selected, check) come from the
already-imported `chessground.brown.css`. We keep that base import for the
interactive-square styling and override only the `cg-board` checkerboard per
theme, scoped by a `board-theme-<id>` wrapper class placed on `ChessBoard`'s
outer element (Task 5). A scoped selector (`.board-theme-x cg-board`,
specificity 0,1,1) overrides the base `cg-board` rule (0,0,1).

- [ ] **Step 1: Create the stylesheet**

The checkerboard uses the classic two-offset-linear-gradient recipe: a 25%×25%
tile (= 2 board squares) with dark triangles in opposite corners, the second
gradient offset by 12.5% (= 1 square) to fill the other diagonal, over a
light `background-color`.

```css
/* mychess/src/lib/board/board-themes.css
   Scoped board color themes. Applied via a `.board-theme-<id>` class on the
   ChessBoard wrapper. Interactive square colors come from
   chessground.brown.css (imported in app.css); this file only recolors the
   board squares themselves. */

.board-theme-brown cg-board {
	background-color: #f0d9b5;
	background-image:
		linear-gradient(45deg, #b58863 25%, transparent 25%, transparent 75%, #b58863 75%),
		linear-gradient(45deg, #b58863 25%, transparent 25%, transparent 75%, #b58863 75%);
	background-size: 25% 25%;
	background-position: 0 0, 12.5% 12.5%;
}

.board-theme-green cg-board {
	background-color: #ebecd0;
	background-image:
		linear-gradient(45deg, #779556 25%, transparent 25%, transparent 75%, #779556 75%),
		linear-gradient(45deg, #779556 25%, transparent 25%, transparent 75%, #779556 75%);
	background-size: 25% 25%;
	background-position: 0 0, 12.5% 12.5%;
}

.board-theme-blue cg-board {
	background-color: #dee3e6;
	background-image:
		linear-gradient(45deg, #8ca2ad 25%, transparent 25%, transparent 75%, #8ca2ad 75%),
		linear-gradient(45deg, #8ca2ad 25%, transparent 25%, transparent 75%, #8ca2ad 75%);
	background-size: 25% 25%;
	background-position: 0 0, 12.5% 12.5%;
}

.board-theme-midnight cg-board {
	background-color: #6b7a8f;
	background-image:
		linear-gradient(45deg, #3b4657 25%, transparent 25%, transparent 75%, #3b4657 75%),
		linear-gradient(45deg, #3b4657 25%, transparent 25%, transparent 75%, #3b4657 75%);
	background-size: 25% 25%;
	background-position: 0 0, 12.5% 12.5%;
}
```

- [ ] **Step 2: Import it in app.css**

Add after the existing chessground imports in `mychess/src/app.css`:

```css
@import './lib/board/board-themes.css';
```

The file's first 4 lines currently are:
```css
@import 'tailwindcss';
@import 'chessground/assets/chessground.base.css';
@import 'chessground/assets/chessground.brown.css';
@import 'chessground/assets/chessground.cburnett.css';
```
Insert the new `@import './lib/board/board-themes.css';` immediately below line 3 (the brown import) so theme overrides load after the base brown background.

- [ ] **Step 3: Verify build resolves the import**

Run: `npm run check`
Expected: no new errors beyond the known ~12 OAuth baseline (CSS import resolution is validated by the build; a broken path would surface later in `npm run build`, so also confirm with a quick `npm run build` if unsure).

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/board/board-themes.css mychess/src/app.css
git commit -m "feat: scoped board color themes"
```

---

## Task 4: Piece set assets (merida + alpha)

**Files:**
- Create: `mychess/static/pieces/merida/*.svg`, `mychess/static/pieces/alpha/*.svg`
- Create: `mychess/static/pieces/LICENSE`
- Create: `mychess/src/lib/board/pieces.css`
- Modify: `mychess/src/app.css`

cburnett stays the global default (`chessground.cburnett.css`, already imported).
merida and alpha are added as scoped rules pointing at static SVG files. The
scoped selector `.pieces-merida .cg-wrap piece.pawn.white` (specificity 0,2,1)
overrides the global cburnett rule `.cg-wrap piece.pawn.white` (0,1,1).

- [ ] **Step 1: Download the SVG piece art**

Piece art is from the Lichess `lila` repo (GPLv2+). Roles map to filenames:
pawn→P, knight→N, bishop→B, rook→R, queen→Q, king→K; color w/b.

```bash
cd mychess
for set in merida alpha; do
  mkdir -p "static/pieces/$set"
  for color in w b; do
    for piece in P N B R Q K; do
      curl -fsSL \
        "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/$set/$color$piece.svg" \
        -o "static/pieces/$set/$color$piece.svg"
    done
  done
done
ls static/pieces/merida static/pieces/alpha
```
Expected: 12 `.svg` files in each directory. If a URL 404s (upstream path change), find the current path under `lichess-org/lila/tree/master/public/piece` and adjust — the filenames (`wP.svg` … `bK.svg`) are stable.

- [ ] **Step 2: Add the license note**

```
mychess/static/pieces/LICENSE
```
```
The merida and alpha chess piece SVGs in this directory are from the Lichess
lila project (https://github.com/lichess-org/lila), licensed under the GNU
General Public License version 2 (or later). See
https://github.com/lichess-org/lila/blob/master/COPYING.md for details.
```

- [ ] **Step 3: Create the scoped piece CSS**

```css
/* mychess/src/lib/board/pieces.css
   Additional piece sets, scoped by a `.pieces-<id>` class on the ChessBoard
   wrapper. cburnett is the default and comes from chessground.cburnett.css
   (imported globally in app.css). Files live in /static/pieces/<set>/. */

.pieces-merida .cg-wrap piece.pawn.white { background-image: url('/pieces/merida/wP.svg'); }
.pieces-merida .cg-wrap piece.knight.white { background-image: url('/pieces/merida/wN.svg'); }
.pieces-merida .cg-wrap piece.bishop.white { background-image: url('/pieces/merida/wB.svg'); }
.pieces-merida .cg-wrap piece.rook.white { background-image: url('/pieces/merida/wR.svg'); }
.pieces-merida .cg-wrap piece.queen.white { background-image: url('/pieces/merida/wQ.svg'); }
.pieces-merida .cg-wrap piece.king.white { background-image: url('/pieces/merida/wK.svg'); }
.pieces-merida .cg-wrap piece.pawn.black { background-image: url('/pieces/merida/bP.svg'); }
.pieces-merida .cg-wrap piece.knight.black { background-image: url('/pieces/merida/bN.svg'); }
.pieces-merida .cg-wrap piece.bishop.black { background-image: url('/pieces/merida/bB.svg'); }
.pieces-merida .cg-wrap piece.rook.black { background-image: url('/pieces/merida/bR.svg'); }
.pieces-merida .cg-wrap piece.queen.black { background-image: url('/pieces/merida/bQ.svg'); }
.pieces-merida .cg-wrap piece.king.black { background-image: url('/pieces/merida/bK.svg'); }

.pieces-alpha .cg-wrap piece.pawn.white { background-image: url('/pieces/alpha/wP.svg'); }
.pieces-alpha .cg-wrap piece.knight.white { background-image: url('/pieces/alpha/wN.svg'); }
.pieces-alpha .cg-wrap piece.bishop.white { background-image: url('/pieces/alpha/wB.svg'); }
.pieces-alpha .cg-wrap piece.rook.white { background-image: url('/pieces/alpha/wR.svg'); }
.pieces-alpha .cg-wrap piece.queen.white { background-image: url('/pieces/alpha/wQ.svg'); }
.pieces-alpha .cg-wrap piece.king.white { background-image: url('/pieces/alpha/wK.svg'); }
.pieces-alpha .cg-wrap piece.pawn.black { background-image: url('/pieces/alpha/bP.svg'); }
.pieces-alpha .cg-wrap piece.knight.black { background-image: url('/pieces/alpha/bN.svg'); }
.pieces-alpha .cg-wrap piece.bishop.black { background-image: url('/pieces/alpha/bB.svg'); }
.pieces-alpha .cg-wrap piece.rook.black { background-image: url('/pieces/alpha/bR.svg'); }
.pieces-alpha .cg-wrap piece.queen.black { background-image: url('/pieces/alpha/bQ.svg'); }
.pieces-alpha .cg-wrap piece.king.black { background-image: url('/pieces/alpha/bK.svg'); }
```

- [ ] **Step 4: Import it in app.css**

Add below the `board-themes.css` import in `mychess/src/app.css`:

```css
@import './lib/board/pieces.css';
```

- [ ] **Step 5: Commit**

```bash
git add mychess/static/pieces mychess/src/lib/board/pieces.css mychess/src/app.css
git commit -m "feat: bundle merida + alpha piece sets"
```

---

## Task 5: `ChessBoard.svelte` prefs prop

**Files:**
- Modify: `mychess/src/lib/components/ChessBoard.svelte`

- [ ] **Step 1: Add the import and prop**

At the top of the `<script>` block, add to the existing imports:

```ts
import { DEFAULT_PREFS, animationDuration, type BoardPrefs } from '$lib/board/prefs';
```

Extend the `Props` type with:

```ts
		prefs?: BoardPrefs;
```

Extend the destructured props (add `prefs` with a default) so it reads:

```ts
	let {
		fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		orientation = 'white' as Color,
		interactable = true,
		lastMove = undefined,
		prefs = DEFAULT_PREFS,
		onmove
	}: Props = $props();
```

- [ ] **Step 2: Wire prefs into the chessground config**

In `buildConfig()`, replace the final two config properties:

```ts
			lastMove,
			highlight: { lastMove: true, check: true },
			animation: { enabled: true, duration: 150 }
```
with:
```ts
			lastMove,
			coordinates: prefs.coordinates,
			highlight: { lastMove: prefs.highlight, check: prefs.highlight },
			animation: {
				enabled: animationDuration(prefs.animation) > 0,
				duration: animationDuration(prefs.animation)
			}
```

- [ ] **Step 3: Apply theme + piece classes on the wrapper**

Change the outer wrapper `<div>` so the theme/piece classes are present as
ancestors of the chessground-created `cg-board`/`.cg-wrap` elements:

```svelte
<div
	class="relative w-full aspect-square rounded-xl overflow-hidden shadow-2xl board-theme-{prefs.theme} pieces-{prefs.pieceSet}"
>
```

Leave the inner `<div bind:this={el} ...>` and the `correctSquare` badge markup unchanged.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new errors beyond the known ~12 OAuth baseline. In particular, `prefs` is typed and `buildConfig` compiles.

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/ChessBoard.svelte
git commit -m "feat: ChessBoard prefs prop (theme/pieces/animation/coords/highlight)"
```

---

## Task 6: Expose prefs through the (player) layout

**Files:**
- Modify: `mychess/src/routes/(player)/+layout.server.ts`

- [ ] **Step 1: Return parsed boardPrefs**

Add the import at the top:

```ts
import { parseBoardPrefs } from '$lib/board/prefs';
```

Change the two `return data;` sites so the loaded data carries `boardPrefs`.
Replace the final `return data;` with:

```ts
	return { ...data, boardPrefs: parseBoardPrefs((data.profile as any)?.board_prefs) };
```

The guest/anonymous and player paths all fall through to this final return, so a
single change covers them; the two `throw redirect(...)` branches are unaffected.

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no new errors beyond baseline. `data.boardPrefs` is now available in `(player)` page `data`.

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(player)/+layout.server.ts"
git commit -m "feat: load board prefs in player layout"
```

---

## Task 7: Settings save action

**Files:**
- Modify: `mychess/src/routes/(player)/settings/+page.server.ts`

- [ ] **Step 1: Add the import**

Add to the existing imports at the top:

```ts
import { parseBoardPrefs } from '$lib/board/prefs';
```

- [ ] **Step 2: Add the `save_board_prefs` action**

Inside the `actions` object, add a new action (e.g. after `disconnect_lichess`).
It builds a candidate object from the form and runs it through `parseBoardPrefs`
so the client can never store an invalid value:

```ts
	save_board_prefs: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Unauthorized' });

		const fd = await request.formData();
		const prefs = parseBoardPrefs({
			theme: fd.get('theme'),
			pieceSet: fd.get('pieceSet'),
			animation: fd.get('animation'),
			coordinates: fd.get('coordinates') === 'true',
			highlight: fd.get('highlight') === 'true'
		});

		const { error } = await supabase
			.from('profiles')
			.update({ board_prefs: prefs } as any)
			.eq('id', user.id);

		if (error) return fail(500, { error: error.message });
		return { success: true };
	}
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors beyond baseline.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(player)/settings/+page.server.ts"
git commit -m "feat: settings action to save board prefs"
```

---

## Task 8: Settings UI — Board section + live preview

**Files:**
- Modify: `mychess/src/routes/(player)/settings/+page.svelte`

- [ ] **Step 1: Add imports and local state**

In the `<script>` block, add these imports:

```ts
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import {
		BOARD_THEMES,
		PIECE_SETS,
		ANIMATION_SPEEDS,
		DEFAULT_PREFS,
		type BoardPrefs
	} from '$lib/board/prefs';
```

Add local editable state seeded from layout-provided prefs (falls back to
defaults). Place it after the existing `const d = $derived(data as any);` line:

```ts
	let boardPrefs = $state<BoardPrefs>({ ...(d.boardPrefs ?? DEFAULT_PREFS) });

	// A sample position after 1.e4 with a last move so the highlight toggle is visible.
	const PREVIEW_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
	const PREVIEW_LAST_MOVE = ['e2', 'e4'] as ['e2', 'e4'];

	const boardEnhance = () => async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
		await update({ reset: false });
	};
```

- [ ] **Step 2: Add the Board section markup**

Add this section inside the settings container (the
`<div class="max-w-2xl mx-auto px-4 py-6 space-y-5">`), after the existing
profile card. It has a live preview, four control groups reusing the project's
button-toggle pattern (buttons + hidden inputs, not `<select>`), and Save / Reset:

```svelte
<div class="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
	<h2 class="text-lg font-semibold text-gray-900">Board</h2>

	<div class="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
		<div class="max-w-[260px] w-full">
			<ChessBoard
				fen={PREVIEW_FEN}
				interactable={false}
				lastMove={PREVIEW_LAST_MOVE}
				prefs={boardPrefs}
			/>
		</div>

		<form method="POST" action="?/save_board_prefs" use:enhance={boardEnhance} class="space-y-4">
			<div>
				<span class="block text-xs uppercase tracking-wide text-gray-500 mb-2">Theme</span>
				<div class="flex flex-wrap gap-2">
					{#each BOARD_THEMES as t (t.id)}
						<button
							type="button"
							onclick={() => (boardPrefs.theme = t.id)}
							class="w-10 h-10 rounded-md border-2 {boardPrefs.theme === t.id ? 'border-blue-500' : 'border-transparent'}"
							style="background: linear-gradient(135deg, {t.light} 0 50%, {t.dark} 50% 100%);"
							aria-label={t.label}
							title={t.label}
						></button>
					{/each}
				</div>
				<input type="hidden" name="theme" value={boardPrefs.theme} />
			</div>

			<div>
				<span class="block text-xs uppercase tracking-wide text-gray-500 mb-2">Piece set</span>
				<div class="flex flex-wrap gap-2">
					{#each PIECE_SETS as p (p.id)}
						<button
							type="button"
							onclick={() => (boardPrefs.pieceSet = p.id)}
							class="px-3 py-1.5 rounded-md text-sm border {boardPrefs.pieceSet === p.id ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-700'}"
						>{p.label}</button>
					{/each}
				</div>
				<input type="hidden" name="pieceSet" value={boardPrefs.pieceSet} />
			</div>

			<div>
				<span class="block text-xs uppercase tracking-wide text-gray-500 mb-2">Animation</span>
				<div class="flex flex-wrap gap-2">
					{#each ANIMATION_SPEEDS as a (a.id)}
						<button
							type="button"
							onclick={() => (boardPrefs.animation = a.id)}
							class="px-3 py-1.5 rounded-md text-sm border {boardPrefs.animation === a.id ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-300 text-gray-700'}"
						>{a.label}</button>
					{/each}
				</div>
				<input type="hidden" name="animation" value={boardPrefs.animation} />
			</div>

			<label class="flex items-center gap-2 text-sm text-gray-700">
				<input type="checkbox" bind:checked={boardPrefs.coordinates} />
				Show coordinates
			</label>
			<input type="hidden" name="coordinates" value={boardPrefs.coordinates} />

			<label class="flex items-center gap-2 text-sm text-gray-700">
				<input type="checkbox" bind:checked={boardPrefs.highlight} />
				Highlight last move
			</label>
			<input type="hidden" name="highlight" value={boardPrefs.highlight} />

			<div class="flex gap-2 pt-1">
				<button type="submit" class="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium">Save</button>
				<button
					type="button"
					onclick={() => (boardPrefs = { ...DEFAULT_PREFS })}
					class="px-4 py-2 rounded-md border border-gray-300 text-gray-700 text-sm"
				>Reset to default</button>
			</div>
		</form>
	</div>
</div>
```

Note: the hidden inputs mirror `boardPrefs` state so the posted form carries the
current selection; `coordinates`/`highlight` post the string `"true"`/`"false"`,
which the Task 7 action compares with `=== 'true'`.

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors beyond baseline.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(player)/settings/+page.svelte"
git commit -m "feat: board customization settings section with live preview"
```

---

## Task 9: Apply prefs to in-app boards

**Files:**
- Modify: `mychess/src/routes/(player)/drill/+page.svelte`
- Modify: `mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/+page.svelte`
- Modify: `mychess/src/routes/(player)/time-trial/+page.svelte`

Each of these pages already renders `<ChessBoard ... />` and is under the
`(player)` group, so `data.boardPrefs` is available. Add the prop to each.

- [ ] **Step 1: drill**

In `mychess/src/routes/(player)/drill/+page.svelte`, change:
```svelte
<ChessBoard fen={boardFen} interactable={true} onmove={handleMove} />
```
to:
```svelte
<ChessBoard fen={boardFen} interactable={true} onmove={handleMove} prefs={data.boardPrefs} />
```

- [ ] **Step 2: master/train**

In `mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte`, change:
```svelte
<ChessBoard fen={boardFen} interactable={phase === 'playing'} onmove={handleMove} />
```
to:
```svelte
<ChessBoard fen={boardFen} interactable={phase === 'playing'} onmove={handleMove} prefs={data.boardPrefs} />
```

- [ ] **Step 3: practice + time-trial**

In each of `mychess/src/routes/(player)/practice/+page.svelte` and
`mychess/src/routes/(player)/time-trial/+page.svelte`, find the `<ChessBoard ... />`
usage and add `prefs={data.boardPrefs}` to its props. If a page does not already
expose `data` in its `<script>` (`let { data } = $props<{ data: any }>();`), add
that binding first, matching the sibling pages' pattern.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new errors beyond baseline.

- [ ] **Step 5: Commit**

```bash
git add "mychess/src/routes/(player)/drill/+page.svelte" \
  "mychess/src/routes/(player)/master/[repertoire_id]/+page.svelte" \
  "mychess/src/routes/(player)/practice/+page.svelte" \
  "mychess/src/routes/(player)/time-trial/+page.svelte"
git commit -m "feat: apply board prefs to drill/master/practice/time-trial boards"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + type gate**

Run: `npm test`
Expected: all tests pass, including `src/lib/board/prefs.test.ts`.

Run: `npm run check`
Expected: no new errors beyond the known ~12 OAuth baseline.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build succeeds (confirms the new CSS `@import`s and static piece paths resolve).

- [ ] **Step 3: Manual verification (requires migration applied — Task 1 Step 3)**

Run `npm run dev`, then:
1. Open `/settings`, scroll to the **Board** section.
2. Change theme, piece set, animation, and both toggles — confirm the live preview updates on each change.
3. Click **Save**, reload the page — confirm the section shows the saved values (persistence round-trips through the profile).
4. Open `/drill` (and `/master/<id>` training) — confirm the chosen theme, pieces, animation speed, coordinate visibility and last-move highlight all apply there.
5. Click **Reset to default**, confirm the preview returns to brown/cburnett/subtle/coords-on/highlight-on (note: not persisted until Save).
6. In a private window (guest/anonymous session), open a board — confirm it renders with defaults and no console errors.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide integration
(this project commits directly to `main`, which auto-deploys via Vercel).

---

## Self-review notes

- **Spec coverage:** migration (Task 1), pure logic + tests (Task 2), themes CSS (Task 3), piece sets (Task 4), component prefs (Task 5), SSR wiring (Task 6), save action (Task 7), settings UI with explicit Save + Reset and live preview (Task 8), app-wide application (Task 9), verification incl. guest path (Task 10). All spec sections mapped.
- **Type consistency:** `BoardPrefs`, `parseBoardPrefs`, `animationDuration`, `DEFAULT_PREFS`, `BOARD_THEMES`, `PIECE_SETS`, `ANIMATION_SPEEDS` are defined once in Task 2 and referenced with the same names/shapes in Tasks 5–8. Wrapper classes `board-theme-<id>` / `pieces-<id>` are consistent between Tasks 3, 4 and 5. Form field names (`theme`, `pieceSet`, `animation`, `coordinates`, `highlight`) match between Task 7 (reader) and Task 8 (writer).
- **External dependency:** Task 4 Step 1 fetches GPL piece art over the network; if offline at execution, that task blocks — the rest can proceed and cburnett/all themes still work.
