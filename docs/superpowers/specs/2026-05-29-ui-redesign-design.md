# UI Redesign: mychess — Professional Chess Player Dashboard

**Date:** 2026-05-29  
**Status:** Draft  
**Reference:** chessreps.com  

---

## Overview

Rework the mychess visual design from a gamified, kid-oriented dark dashboard into a clean, professional interface aimed at active adult OTB chess players. The goal is a "serious player's daily tab" — uncluttered, fast to scan, and focused on real chess data: FIDE rating, standings, tournaments, and study tools.

All existing functionality is kept; only the visual presentation changes.

---

## 1. Design System

### Color Palette

| Role | Token | Value |
|------|-------|-------|
| Page background | `bg-gray-50` | #f9fafb |
| Surface (cards) | `bg-white` | #ffffff |
| Border | `border-gray-200` | #e5e7eb |
| Heading text | `text-gray-900` | #111827 |
| Body text | `text-gray-600` | #4b5563 |
| Muted/label | `text-gray-400` | #9ca3af |
| Accent (primary) | `text-indigo-600` / `bg-indigo-600` | #4f46e5 |
| Accent hover | `bg-indigo-700` | #4338ca |
| Success | `text-green-600` | #16a34a |
| Warning/streak | `text-orange-500` | #f97316 |
| Danger | `text-red-600` | #dc2626 |

**Out:** All `bg-slate-900`, `bg-slate-800`, `yellow-400`, `amber-600`, `purple-800` gamification colors.

### Typography

- Font: system-ui stack (current default — no change needed)
- Headings: `font-semibold` / `font-bold`, `text-gray-900`
- Body: `text-gray-600`
- Labels/captions: `text-xs text-gray-400`

### Cards

Standard card pattern used consistently:

```
bg-white rounded-xl border border-gray-200 shadow-sm p-4
```

Hover state: `hover:shadow-md transition-shadow`

### Buttons

- **Primary:** `bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700`
- **Secondary:** `border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-50`
- **Ghost/link:** `text-indigo-600 hover:underline`

---

## 2. Navigation

Replace the tile-grid navigation with a persistent top navigation bar. Added to the root `+layout.svelte` so it appears on all pages **except** `/login`, `/join`, `/welcome` (those pages retain a minimal layout without nav).

### Top Nav Structure

```
[♟ mychess]   [Dashboard] [Tournaments] [Learn] [Repertoires]   [🔥 5  •  username ▾]
```

- **Left:** ♟ logo + "mychess" wordmark — always links to `/`
- **Center:** Main nav links (authenticated players only, hidden for guests)
- **Right:** Context-dependent — see states below
- **Active link:** underlined + `text-indigo-600 font-semibold`
- **Mobile:** hamburger collapses center links; right corner always visible

### Nav States

#### Anonymous / Guest (no Supabase user)
```
[♟ mychess]   [Tournaments]   [Sign in] [Get started →]
```
Only Tournaments is public. Sign in → `/login`. Get started → `/join`.

#### Authenticated Player (kid role)
```
[♟ mychess]   [Dashboard] [Tournaments] [Learn] [Repertoires]   [🔥5 · username ▾]
```
Dropdown behind username: **Settings** (`/settings`) | **Cosmetics** (`/cosmetics`) | **Badges** (`/badges`) | **Sign out** (form POST to `/auth/signout`)

#### Coach (coach role)
```
[♟ mychess]   [Coach Dashboard]   [username ▾]
```
Coach-specific links only. Dropdown: Settings | Sign out.

### Sign Out

Add a `POST /auth/signout` form action to a new route `src/routes/auth/signout/+server.ts` that calls `supabase.auth.signOut()` and redirects to `/login`. The Nav dropdown uses a `<form method="POST" action="/auth/signout">` submit button.

### Active Route Mapping

| URL pattern | Highlighted nav item |
|-------------|---------------------|
| `/` | Dashboard |
| `/tournaments/*` | Tournaments |
| `/learn`, `/drill`, `/practice`, `/time-trial` | Learn |
| `/repertoires/*` | Repertoires |
| `/coach/*` | Coach Dashboard |

### Excluded from Nav

Pages `/login`, `/join`, `/welcome` — nav bar is not rendered. These are standalone auth pages.

### Remove from Dashboard

- Tile-grid navigation tiles
- `/cosmetics`, `/badges` nav tiles (accessible via dropdown instead)

---

## 3. Root Layout Changes

**File:** `mychess/src/routes/+layout.svelte`

Add a `<NavBar />` component above `{@render children()}`, **conditionally rendered** — excluded on auth pages (`/login`, `/join`, `/welcome`).

The root `+layout.server.ts` already returns `{ user, session, profile }` from `safeGetSession()`. This data flows to `NavBar` via the existing SvelteKit parent data mechanism.

**File:** `mychess/src/routes/(kid)/+layout.svelte`  
Remove the yellow guest banner — the new NavBar handles guest state (no authenticated-links shown). This avoids double-sticky UI.

**New file:** `mychess/src/routes/auth/signout/+server.ts`  
Handles `POST /auth/signout`: calls `supabase.auth.signOut()` and redirects to `/login`.

---

## 4. Dashboard Page Redesign

**File:** `mychess/src/routes/(kid)/+page.svelte`

### Guest State (unauthenticated)

Clean landing section (currently mostly good, just needs background color fix):

```
[White background, max-w-4xl]
  H1: "Your chess, all in one place"
  Subtitle: "FIDE rating, national standings, and local OTB tournaments."
  CTA buttons: [Browse tournaments (indigo)] [Sign in (outlined)]
  ─────────────────────────────────────────────────────
  Upcoming tournaments card grid (already built, keep)
```

### Authenticated State

Replace the dark gamified layout with this section stack:

#### 4a. Player Header

```
[Card: player identity row]
  Left: Avatar circle (initials, bg-indigo-100 text-indigo-700)
  Center:
    Name (font-bold text-xl)
    FIDE ID / Club (text-gray-500 text-sm)
  Right:
    FIDE Rating badge (large, e.g. "1847 FIDE" in text-2xl font-bold)
    Rating type label (text-xs text-gray-400, e.g. "Classical")
```

FIDE rating sourced from profile fields (existing `fide_id` or placeholder until user links account). Shows "– –" if not set, with a "Link FIDE account" prompt.

#### 4b. Stats Row (3 cards, inline)

```
[ Country Rank ]   [ Age Group Rank ]   [ Streak ]
  #142 in LT          #8 U18             🔥 5 days
```

Each is a compact card (`p-3 text-center`). Country/age rank placeholders initially; shown when FIDE API data is available.

#### 4c. Quick Actions (4-button grid)

```
[Daily Review]   [Practice]   [Drill]   [Time Trial]
  indigo text     gray text    gray       gray
  "X cards"      "Full board"  "Precise"  "60s"
```

Clean text buttons, no emoji tiles. Uniform size, subtle border, hover state. The first/primary action gets indigo accent.

#### 4d. Today's Tasks (formerly "Daily Quests")

Rename to "Today's tasks" — same data, completely restyled:

```
[Card: Today's tasks]
  - Complete 10 flashcards   ✓ 10/10  [green check]
  - Study 1 repertoire line  ○ 0/1   [progress bar, indigo]
  - Drill 5 moves            ○ 3/5   [progress bar, indigo]
```

No XP reward badges shown inline. Simple progress bars, check marks for complete. No colored tiles.

#### 4e. Upcoming Tournaments (widget)

Already built as part of Phase 1 — keep. Restyle border/background to match new card style.

#### 4f. Coach Note (formerly SirKnight)

Remove SirKnight character entirely. Coach notes become a simple info banner:

```
[bg-indigo-50 border-l-4 border-indigo-400 p-3 rounded-r-lg]
  "Coach note:" text-indigo-700 font-semibold
  Note message text-gray-700
  [Dismiss ×]
```

#### 4g. Remove Entirely

- `SirKnight.svelte` usage (coach notes replaced with banner)
- XP bar / "XP to next level" progress bar
- "Lv N" badge in header
- Leaderboard podium (remove from dashboard; move to dedicated `/leaderboard` if needed)
- Streak freeze display (move to settings/profile)
- Cosmetics tile & Trophies tile from nav grid

---

## 5. Tournament Pages

The tournaments list page (`/tournaments`) is already mostly clean. Minor updates:

- Background: change any `dark:` variants to rely on the new light-only design (dark mode not in scope for this redesign)  
- Active filter button color: change `bg-blue-600` → `bg-indigo-600` for consistency
- Card hover states: align with new card pattern

Tournament detail page: same treatment — remove dark mode classes, align button styles.

---

## 6. Component Inventory

### Components to Restyle (keep, visual update only)

| Component | Change |
|-----------|--------|
| `TournamentCard.svelte` | Remove dark: classes, align card style |
| `TournamentFilters.svelte` | Active state color → indigo |
| `XpBar.svelte` | Keep for profile/settings page; remove from main dashboard |
| `StreakBadge.svelte` | Restyle for top nav use (compact pill) |

### Components to Remove from Dashboard Usage

| Component | Action |
|-----------|--------|
| `SirKnight.svelte` | Keep file, remove from dashboard; may still be used elsewhere |
| `LeaderboardPodium.svelte` | Remove from dashboard; keep file |
| `DailyGoalRing.svelte` | Remove from dashboard |

### New Components to Create

| Component | Purpose |
|-----------|---------|
| `NavBar.svelte` | Persistent top nav bar (logo, links, user menu) |
| `PlayerHeader.svelte` | Player identity + FIDE rating card for dashboard |
| `StatsRow.svelte` | 3-card country/age-group/streak stat row |
| `QuickActions.svelte` | 4-button action grid |
| `CoachNoteBanner.svelte` | Simple banner replacing SirKnight |

---

## 7. Pages Explicitly Out of Scope (Visual Only)

The following pages will inherit the new light palette automatically (once dark slate defaults are removed) but will not be restructured. They still need mechanical cleanup of `bg-slate-900`/`bg-slate-800` classes:

| Page | Status |
|------|--------|
| `/learn` | Mechanical class swap |
| `/practice` | Mechanical class swap |
| `/drill` | Mechanical class swap |
| `/time-trial` | Mechanical class swap |
| `/repertoires` | Mechanical class swap |
| `/settings` | Mechanical class swap + FIDE ID field added |
| `/cosmetics` | Mechanical class swap |
| `/badges` | Mechanical class swap |
| `/(coach)/*` | Mechanical class swap (coach portal pages) |
| `/login`, `/join`, `/welcome` | Minimal — light background only, no nav bar |

"Mechanical class swap" = replace `bg-slate-900` → `bg-gray-50`, `bg-slate-800` → `bg-white border border-gray-200`, `text-yellow-400` headings → `text-indigo-600`, form inputs `bg-slate-700` → `bg-white border border-gray-300 text-gray-900`.

---

## 8. Global CSS Changes

**File:** `mychess/src/app.html`  
Change `theme-color` meta from `#f59e0b` (amber) to `#4f46e5` (indigo).

**File:** `mychess/src/app.css`  
Add CSS custom properties for new palette (supports future dark mode implementation):

```css
:root {
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-bg: #f9fafb;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --color-text: #111827;
  --color-muted: #6b7280;
}
```

---

## 9. FIDE Rating Integration (Scaffold)

Per the original user request ("check his FIDE rating"), the dashboard shows a FIDE rating widget.

### Database Changes Required

Add two columns to the `profiles` table via a new migration:

```sql
alter table profiles add column if not exists fide_id text;
alter table profiles add column if not exists fide_rating integer;
```

These are nullable — most users will not have FIDE data initially.

### Dashboard Server Load

`(kid)/+page.server.ts`: Extend the profile select to include `fide_id, fide_rating` fields (already fetched as `p = profile`).

### Dashboard UI

- If `fide_rating` is set: show the rating prominently (e.g., "**1847** FIDE Classical")
- If not set: show "– –" with a "Link FIDE account →" link to `/settings`

### Settings Page

Add FIDE ID input field to `/settings` (alongside chess.com and lichess username inputs). Player enters their FIDE ID manually; the app stores it. Live rating sync from the FIDE API is deferred to a future phase.

---

## 10. Implementation Phasing

This redesign is deliverable in a single implementation plan with these phases:

1. **Design foundations** — app.html, app.css, CSS variables, Tailwind config
2. **NavBar component + root layout** — persistent nav replaces tile-grid
3. **Dashboard page redesign** — full rework of `(kid)/+page.svelte` + new components
4. **Tournament pages alignment** — minor style fixes on existing clean pages
5. **Global cleanup** — remove dark: classes from all pages, ensure light-mode consistency

---

## Success Criteria

- No dark slate backgrounds visible on any page when loaded fresh (light mode)
- No amber/yellow-400 gamification chrome on the main dashboard
- Persistent top nav visible on all pages
- Player name + FIDE rating visible at a glance on the dashboard
- Tournament list and detail pages visually consistent with the new design
- Existing functionality (learn, drill, tournaments, repertoires) all still accessible and working
- Build passes with no TypeScript errors
