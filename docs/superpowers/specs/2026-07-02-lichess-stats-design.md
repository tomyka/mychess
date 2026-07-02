# Lichess Rating Stats

**Date:** 2026-07-02
**Status:** Approved

## Problem

Users connect their Lichess account (via the existing OAuth flow) so MyChess can import games, but their Lichess ratings are never shown anywhere in the app. Lichess exposes ratings and other profile data through a public API — no additional auth needed beyond the username already stored on `profiles.lichess_username`.

## Goal

Show the connected user's Lichess ratings per variant (Bullet, Blitz, Rapid, Classical) in two places: a full breakdown on the Settings page, and a compact single-badge summary on the dashboard, styled consistently with the existing FIDE rating badge in `PlayerHeader.svelte`.

Chess.com stats are out of scope for this change (see Out of Scope).

## Architecture

### Server helper

New file `src/lib/server/lichess.ts`:

```ts
export type LichessRatings = {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  classical?: number;
};

export async function fetchLichessRatings(username: string): Promise<LichessRatings | null>
```

- Calls `GET https://lichess.org/api/user/{username}` (public endpoint, no auth — same pattern as the existing games-import fetch in `api/import/lichess/+server.ts`).
- Maps the response's `perfs` object to `LichessRatings`, including a variant only when `perfs.<key>.games > 0` (Lichess returns a provisional entry even for unplayed variants; we don't want to show a meaningless number).
- Returns `null` on any fetch failure, non-200 response, or JSON parse error. Never throws — callers render a fallback state instead of crashing the page load.
- On `null`, logs the username and status/error server-side (`console.error`), matching the existing `tErr` logging style in `(kid)/+page.server.ts`.
- No retries. A failed load shows the "couldn't load" state; the next page load tries again naturally.

### Data flow

- `(kid)/settings/+page.server.ts` `load`: if `profile.lichess_username` is set, call `fetchLichessRatings(username)` and add `lichessRatings` to the returned data.
- `(kid)/+page.server.ts` `load`: same conditional call, added into the existing `Promise.all([...])` alongside the stats/quests/leaderboard/notes fetches so it doesn't add serial latency. Exposed as `lichessRatings`.
- Neither fetch happens if `lichess_username` is unset (avoids a pointless call for unconnected users).
- Fetch is scoped to only these two pages — not the `(kid)/+layout.server.ts` load — so pages that don't display stats (drill, practice, badges, etc.) never pay for a Lichess API round-trip.

### Component

New `src/lib/components/LichessStatsCard.svelte`, props: `{ ratings: LichessRatings | null; username: string | null; compact?: boolean }`.

Render states:
- `username` is `null` → not connected: "Connect Lichess to see your ratings", linking to `/settings`.
- `username` set, `ratings` is `null` → fetch failed: "Couldn't load Lichess stats right now."
- `username` set, `ratings` is `{}` (no perfs with games played) → "No rated games yet."
- Otherwise → one badge per available variant, each showing rating value + uppercase label, visually matching the FIDE rating badge in `PlayerHeader.svelte` (large bold number, small label underneath).

`compact` mode (used on the dashboard) renders only the single highest-priority rating: blitz, falling back to rapid → classical → bullet if blitz has no games. Falls back to the "not connected" / "couldn't load" / "no rated games" messaging same as full mode when applicable.

### UI placement

- **Settings** (`(kid)/settings/+page.svelte`): full `LichessStatsCard` (not compact), placed inside the existing "Connected accounts" section, directly under the Lichess connect/disconnect row.
- **Dashboard** (`(kid)/+page.svelte`): compact `LichessStatsCard`, placed as a badge next to `PlayerHeader`.

## Testing

- `src/lib/server/lichess.test.ts` (vitest, `node` environment — same as `fide.test.ts`/`oauth.test.ts`): perf with `games > 0` included, perf with `games === 0` excluded, non-200 response → `null`, malformed JSON → `null`.
- `src/lib/components/LichessStatsCard.test.ts` (vitest, `jsdom` environment, using `@testing-library/svelte`): renders each of the four states (not connected, fetch failed, no rated games, ratings shown) and asserts the expected text/badges appear. This is the first component-render test in the project — no prior component test setup exists (only unauthenticated Playwright e2e in `tests/app.e2e.ts`, and plain-node unit tests for server helpers).
- New devDependencies: `@testing-library/svelte`, `jsdom`.
- Vitest config needs an environment split: `node` (default, current behavior) for `lib/server/**/*.test.ts`, `jsdom` for `lib/components/**/*.test.ts`. Exact mechanism (`environmentMatchGlobs` or per-file `// @vitest-environment jsdom` pragma) to be decided during implementation.
- No Playwright e2e changes — adding an authenticated fixture (a kid user with `lichess_username` set) is a bigger lift than this feature needs.

## Out of Scope

- Chess.com stats (same pattern could be reused later, but not built now).
- Caching/persisting ratings in the database or refreshing via a cron job — always fetched live.
- Any Lichess data beyond per-variant ratings (game counts, puzzle rating, playtime, etc.).
- Storing or reusing the Lichess OAuth access token — this feature only needs the already-stored public username.
