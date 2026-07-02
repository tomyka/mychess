# Platform Ratings: Lichess + Chess.com Side-by-Side

**Date:** 2026-07-03
**Status:** Approved for planning
**Builds on:** `2026-07-02-lichess-stats-design.md`, `2026-07-03-dashboard-rows-design.md`

## Problem

The dashboard's "Lichess ratings" row only shows Lichess data — Chess.com usernames are stored (`profiles.chesscom_username`, verified on save) but no ratings are ever fetched or shown for that platform. The Lichess side also shows a "Classical" rating that has no Chess.com equivalent, and doesn't show puzzle ratings at all.

## Goal

Split the dashboard's ratings row into two side-by-side areas — Lichess and Chess.com — each showing the same four rating variants (Rapid, Blitz, Bullet, Puzzles) for that platform, with a header line identifying the platform and the player's linked username.

## Decisions

- **Drop Classical from the Lichess display.** Chess.com has no classical/long-time-control equivalent; standardizing both platforms on the same four variants (Rapid/Blitz/Bullet/Puzzles) enables one shared component and a fair side-by-side comparison.
- **Chess.com's "Puzzles" = Tactics rating** (`tactics.highest.rating` from Chess.com's public stats API) — the closest conceptual match to Lichess's puzzle rating (both are rated tactic-solving), as opposed to Puzzle Rush (a timed best-score mode, not an Elo-style rating).
- **Remove the unused `compact` display mode** from the ratings card component. Nothing uses it since the dashboard switched to showing full ratings; keeping it (and its tests) around after this rebuild would be dead code.
- **Settings page stays Lichess-only.** It already shows a full Lichess ratings breakdown; this feature doesn't add a symmetric Chess.com section there. Settings is updated only to keep working with the renamed/generalized component and new rating shape (no visible behavior change on that page beyond the Classical→Puzzles swap already covered above).

## Data layer

### New: `mychess/src/lib/server/chesscom.ts`

```ts
export type ChesscomRatings = {
  rapid?: number;
  blitz?: number;
  bullet?: number;
  puzzle?: number;
};

export async function fetchChesscomRatings(username: string): Promise<ChesscomRatings | null>
```

- Calls `GET https://api.chess.com/pub/player/{username}/stats` (public endpoint, no auth — same trust model as the existing `fetchLichessRatings`).
- Maps: `chess_rapid.last.rating` → `rapid`, `chess_blitz.last.rating` → `blitz`, `chess_bullet.last.rating` → `bullet`, `tactics.highest.rating` → `puzzle`.
- Chess.com omits a variant's top-level key entirely when the player has never played it (no separate "games played" counter to check, unlike Lichess) — so a missing key naturally yields `undefined` for that field with no extra gating logic needed.
- Returns `null` on any fetch failure, non-200 response, or JSON parse error. Never throws. Logs via `console.error` on `null`, matching `fetchLichessRatings`'s pattern exactly (network error, non-OK status, and parse-failure branches, each logging the username and cause).

### Modified: `mychess/src/lib/server/lichess.ts`

```ts
export type LichessRatings = {
  rapid?: number;
  blitz?: number;
  bullet?: number;
  puzzle?: number;
};

const VARIANTS = ['rapid', 'blitz', 'bullet', 'puzzle'] as const;
```

- `classical` removed from the type and `VARIANTS`; `puzzle` added, read from `perfs.puzzle` in the Lichess API response (same `games > 0` gate as the other variants — Lichess's puzzle perf also carries a `games` count).
- No other changes — same fetch/error-handling logic.

## Component

### `mychess/src/lib/components/PlatformRatingsCard.svelte` (replaces `LichessStatsCard.svelte`)

```ts
type PlatformRatings = { rapid?: number; blitz?: number; bullet?: number; puzzle?: number };

props: { platform: string; username: string | null; ratings: PlatformRatings | null }
```

- `DISPLAY_ORDER = ['rapid', 'blitz', 'bullet', 'puzzle']`, `LABELS = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', puzzle: 'Puzzles' }`.
- Header line (shown whenever `username` is set, regardless of whether ratings loaded successfully): `{platform}: {username}` — e.g. "Lichess: DrNykterstein" — styled the same as the existing "Connected as `username`" text elsewhere in Settings.
- States below the header (or in place of it, when not connected):
  - `username` is `null` → "Connect {platform} to see your ratings." linking to `/settings` (same pattern as before, now parametrized by `platform`).
  - `ratings` is `null` (fetch failed) → "Couldn't load {platform} stats right now."
  - `ratings` is `{}` (no variant has data) → "No rated games yet."
  - Otherwise → a `grid-cols-2 gap-3` grid of up to 4 tiles (only variants present, in `DISPLAY_ORDER`), each showing the rating number and its label — visually identical to the existing tile style in `LichessStatsCard`'s full mode.
- The `compact` prop and its rendering branch are removed entirely, along with the priority-fallback logic (`COMPACT_PRIORITY`) it used.

## Layout

`mychess/src/routes/(kid)/+page.svelte`: the current single "Lichess ratings" titled section becomes:

```svelte
<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
    <PlatformRatingsCard platform="Lichess" username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
    <PlatformRatingsCard platform="Chess.com" username={d.chesscomUsername ?? null} ratings={d.chesscomRatings ?? null} />
  </div>
</section>
```

No outer `<h2>` section title — each `PlatformRatingsCard` carries its own platform/username header line, so a redundant "Ratings" heading above both would be visual noise. On narrow screens the two areas stack (`grid-cols-1`); side-by-side from `sm:` up.

## Data flow

`mychess/src/routes/(kid)/+page.server.ts`: add a `chesscomUsername`/`chesscomRatings` fetch, parallel to the existing Lichess one — same conditional-on-username-being-set pattern, added as another slot in the existing `Promise.all`. Both `chesscomUsername` and `chesscomRatings` are added to the page's returned data object.

`mychess/src/routes/(kid)/settings/+page.svelte` and `+page.server.ts`: no new Chess.com ratings fetch here (out of scope, see Decisions). Only change: swap the `LichessStatsCard` usage for `PlatformRatingsCard platform="Lichess" ...` (same data, new component name/shape).

## Testing

- New `mychess/src/lib/server/chesscom.test.ts`, mirroring `lichess.test.ts`'s structure: variant present when its key exists in the Chess.com response, variant absent when the key is missing, `null` on non-200, `null` on malformed JSON, `null` on fetch throwing, correct URL construction.
- `mychess/src/lib/server/lichess.test.ts`: update variant fixtures from `bullet/blitz/rapid/classical` to `bullet/blitz/rapid/puzzle`; behavior/gating logic unchanged, just the variant name swapped in test data.
- `mychess/src/lib/components/PlatformRatingsCard.test.ts` replaces `LichessStatsCard.test.ts`: same four states (not connected, fetch failed, no rated games, ratings shown) but parametrized by a generic `platform` prop instead of being Lichess-specific, using the new `rapid/blitz/bullet/puzzle` shape. Compact-mode tests are deleted, not carried over.
- No new tests for the dashboard/settings `load` functions or `+page.svelte` template changes (matches the established untested pattern for this codebase's page-level wiring, per prior specs).

## Non-goals

- No Chess.com ratings on the Settings page.
- No change to how usernames are verified/connected for either platform (existing OAuth flow for Lichess, existing text-input + live-verification flow for Chess.com are both untouched).
- No caching/persistence of fetched ratings — both platforms are fetched live on every page load, same as today.
