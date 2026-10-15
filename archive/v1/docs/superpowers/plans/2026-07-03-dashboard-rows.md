# Dashboard Full-Width Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the dashboard's cramped two-column player-card row into two full-width rows: `PlayerHeader` alone, then a titled section showing the full (all-variant) `LichessStatsCard`.

**Architecture:** Single-file template change — no component or server logic changes. `PlayerHeader` already renders all 3 FIDE tiles; `LichessStatsCard` already has a full (non-`compact`) display mode. This just rearranges how the dashboard page composes them.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Tailwind CSS.

Spec: `docs/superpowers/specs/2026-07-03-dashboard-rows-design.md`

---

### Task 1: Split the player-card row into two full-width rows

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Replace the two-column row with two stacked full-width rows**

In `mychess/src/routes/(kid)/+page.svelte`, change:

```svelte
      <!-- Player identity + FIDE ratings, with a compact Lichess rating badge alongside -->
      <div class="flex items-stretch gap-3">
        <div class="flex-1">
          <PlayerHeader {profile} fideRatings={d.fideRatings ?? null} />
        </div>
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-center shrink-0">
          <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} compact />
        </div>
      </div>
```

to:

```svelte
      <!-- Player identity + FIDE ratings -->
      <PlayerHeader {profile} fideRatings={d.fideRatings ?? null} />

      <!-- Lichess ratings -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 class="font-semibold text-gray-900 mb-4">Lichess ratings</h2>
        <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
      </section>
```

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to `(kid)/+page.svelte`.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then in a browser as a logged-in (non-anonymous) user:
- Confirm `PlayerHeader` now spans the full width of its row, showing all 3 FIDE tiles without crowding.
- Confirm a new "Lichess ratings" section appears below it, showing all of the player's rated variants (not just one number) when connected, or the "Connect Lichess to see your ratings" prompt when not.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/+page.svelte"
git commit -m "refactor: give the player card and Lichess ratings their own full-width dashboard rows"
```
