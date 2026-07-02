# Dashboard: Full-Width Player Card + Full Lichess Ratings Row

**Date:** 2026-07-03
**Status:** Approved for planning
**Builds on:** `2026-07-02-fide-ratings-card-design.md`, `2026-07-02-lichess-stats-design.md`

## Problem

The dashboard currently squeezes `PlayerHeader` (avatar, name, FIDE ID, 3 FIDE rating tiles) and a compact single-number Lichess badge into one flex row. With `PlayerHeader` now showing three FIDE tiles, that row is cramped, and the Lichess badge only shows one variant (whichever `LichessStatsCard`'s compact-mode priority picks — often mislabeled "Blitz" regardless of the player's most relevant rating).

## Goal

Give `PlayerHeader` its own full-width row, and show the player's full Lichess rating breakdown (all variants, not just one) in a second row below it.

## Change

`mychess/src/routes/(kid)/+page.svelte`: replace the two-column flex row with two stacked full-width rows.

```svelte
<!-- Player identity + FIDE ratings -->
<PlayerHeader {profile} fideRatings={d.fideRatings ?? null} />

<!-- Lichess ratings -->
<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
  <h2 class="font-semibold text-gray-900 mb-4">Lichess ratings</h2>
  <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
</section>
```

- Row 1: `PlayerHeader` as a direct child of the page's existing `space-y-4` vertical stack (no more `flex`/`flex-1`/`shrink-0` wrapper).
- Row 2: a new titled `<section>`, matching the existing visual pattern used for "Today's tasks" and "Upcoming in Lithuania" further down the same page, containing `LichessStatsCard` in its full (non-`compact`) mode — shows all variants the player has rated games in.
- The section always renders, even when not connected — `LichessStatsCard`'s existing "Connect Lichess to see your ratings" prompt covers that case, same as on the Settings page.

## Non-goals

- No changes to `PlayerHeader.svelte`, `LichessStatsCard.svelte`, or `(kid)/+page.server.ts` — both components and the data they need already exist and are already passed into this page's data; this is a template-only rearrangement.

## Testing

No new automated tests. This is a page-level markup change with no new logic — `PlayerHeader` and `LichessStatsCard` are already covered by their own component tests, and this file's `+page.svelte` has no existing test coverage (consistent with how prior wiring-only changes to this same file were handled). Verified manually in the dev server.
