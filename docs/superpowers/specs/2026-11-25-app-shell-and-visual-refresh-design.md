# App shell and visual refresh (#381, part 1)

Issue #381: the owner's main focus is now UX, "the best possible version of
the UX for desktop and mobile". The overhaul is split into sub-projects, each
with its own spec, plan and implementation, in this order (owner,
2026-11-25):

1. **App shell and visual refresh** (this spec).
2. Today (home).
3. Training screen.
4. Repertoire screen.
5. Coach area.
6. Secondary screens (settings, opponent's games, sign-in, welcome, invite).

This spec gives every signed-in screen one navigation frame and one visual
language. It does not redesign any screen's content; later specs do.

## Audit findings this spec answers

A screenshot audit of every route at 390px and 1280px (ux-designer,
2026-11-25, on the persona stack) found, among its ten highest-impact
problems:

- There is no app shell: home is a row of text links, every move between
  areas goes back through home (answered by the tabs).
- Back links differ in wording (five variants), placement and target; an
  assigned repertoire opened from My repertoires links back to Home
  (answered by `PageHeader` with an explicit parent).
- Page widths are inconsistent (`2xl`, `4xl`, `5xl`, `6xl`) and 50-60% of a
  1280px screen is empty on several pages; the import page is left-aligned
  (answered by the one content container).

The other findings (training not the headline on home, no player progress
bars, no Train action per repertoire, the desktop repertoire panel pushing
the board out of view, the move list, the coach dashboard as a form, the
2,500px settings page, destructive actions styled like routine ones) belong
to the later screen specs and are carried into them.

## Rulings applied

New, given by the owner in the #381 brainstorm on 2026-11-25 (recorded in
`docs/owner-rulings.md`):

- **R-218:** Navigation is a bottom tab bar on a phone and a top bar on
  desktop. Tabs: Today, Repertoires, Opponents, plus Coach for an account
  with the coach capability. Account and settings sit behind an avatar
  menu. A drill runs full-screen without the tabs (focus mode).
- **R-219:** The visual style is "calm and modern": cool neutrals, soft
  shadowed cards instead of bordered ones, rounder corners, the Inter
  typeface (self-hosted).
- **R-220:** The colour scheme is "Ocean": a clear blue accent on cool
  neutrals, with a warm walnut board. The state colours (`due`, `learned`,
  `success`, `error`, `skipped`) do not change.

Unchanged and applied: R-7 (mobile-first, installable PWA), R-217 (English
only, all text through the message catalogue), the principles in
`docs/design/README.md` (board dominates, thumb zone, tokens only, WCAG 2.2
AA).

## Navigation model

| Tab | Route | Who | Highlighted for |
| --- | --- | --- | --- |
| Today | `/` | everyone | `/` |
| Repertoires | `/repertoires` | everyone | `/repertoires/**` |
| Opponents | `/fide` | everyone | `/fide` |
| Coach | `/coach` | accounts where `isCoach(account)` | `/coach/**` |

- Tab labels: "Today", "Repertoires", "Opponents", "Coach" (new catalogue
  keys under `nav`). Each tab has an icon and its label; the label is never
  hidden.
- **Today badge:** when the account has Due moves, the Today tab carries an
  amber (`due`) badge with the count (99+ above 99). Its accessible name says
  "Today, 12 due". The count is `todaySummary(account)`'s due total, loaded
  once in the shell layout.
- **Account menu:** the avatar (the display name's initials on an
  `accent-subtle` disc) opens a menu with: the display name, Settings,
  My coaches (`ROUTES.myCoaches`), Theme (System / Light / Dark), Sign out.
  The links and the sign-out button leave the home page; home keeps only its
  content.
- **Focus mode:** `/training` shows no tabs. Its existing frame (back, name,
  progress) stays as it is; the training spec redesigns it.
- **No shell:** `/sign-in`, `/welcome`, `/invite/[token]` and the error and
  not-found pages outside the groups keep their own centred layout.

## Layout

### Phone (below the `md` breakpoint, 768px)

```
+--------------------------------------+
| mychess                         (TK) |  top bar 56px: wordmark, avatar
+--------------------------------------+
| [<] Sicilian, Najdorf           (TK) |  inner page: PageHeader in the bar
|                                      |
|            page content              |  scrolls; padded at the bottom
|                                      |  by the tab bar's height
+--------------------------------------+
|  Today(12)  Repertoires  Opponents   |  tab bar 56px + safe-area inset,
|                              Coach   |  fixed to the bottom
+--------------------------------------+
```

- The tab bar is `position: fixed` at the bottom with
  `padding-bottom: env(safe-area-inset-bottom)`; the viewport meta gets
  `viewport-fit=cover`. Each tab is at least 44 x 44px (`touch`); 3 or 4 tabs
  share the width evenly.
- The top bar is not sticky on a phone (it scrolls away, the tab bar stays).
  On a tab's own page it shows the wordmark and the avatar. On an inner page
  the wordmark gives way to the `PageHeader` (back arrow, 44px, plus the
  page title, clamped to one line); the avatar stays on the right. One row,
  never two.

### Desktop (`md` and up)

```
+------------------------------------------------------------------------------+
| mychess     Today (12)   Repertoires   Opponents   Coach              (TK)   |  56px, sticky
+------------------------------------------------------------------------------+
|   [<] Sicilian, Najdorf                                                      |  PageHeader
|                                                                              |
|   content: max-w 1040px centred on list pages; full width on board pages     |
```

- The top bar is sticky. The active tab has `accent` text and a 2px
  `accent` underline; the others `fg-muted`. No bottom bar.
- Content width: list and form pages use a centred container (`max-w`
  1040px, new token `--container-content`); pages that host a board
  (repertoire views, coach progress and shared repertoire) opt out and use
  the full width with `gutter-wide` padding.

### Inner pages

Every page below a tab gets a `PageHeader`: a back link to its parent (an
explicit `href`, not `history.back()`, so a shared link still has a way
up) and an `h1` title. It replaces the hand-made back links on: repertoire
detail, assigned repertoire, import, coach player, coach progress, coach
shared repertoire, coach group, settings. The tab the page belongs to stays
highlighted.

## Visual refresh (tokens)

All changes are in `apps/web/src/app/tokens.css`; components that already use
tokens change with them. Values are the starting point; the ux-designer
re-checks every contrast pair and may adjust a value to pass (AA: text
4.5:1, controls and focus 3:1) without coming back to the owner.

| Token | Light | Dark |
| --- | --- | --- |
| `bg` | `#f4f5f8` | `#0f1218` |
| `surface` | `#ffffff` | `#181d26` |
| `sunken` | `#e9ecf2` | `#0b0d12` |
| `border` | `#dce0e8` | `#2c3240` |
| `border-strong` | `#7d8597` | `#6b7385` |
| `fg` | `#141a26` | `#e6e9f0` |
| `fg-muted` | `#566075` | `#9aa3b5` |
| `accent` | `#0b63c5` | `#6aaeff` |
| `accent-fg` | `#ffffff` | `#06142a` |
| `accent-subtle` (new) | `#e3eefb` | `#16263d` |
| `focus` | `#0b63c5` | `#6aaeff` |
| `board-light` | `#f0d9b5` | `#d7c2a0` |
| `board-dark` | `#b58863` | `#946f4f` |

- Board overlay tokens (`board-last-move`, `board-selected`, `board-target`,
  `board-hint*`, `board-mark-*`, `board-focus`) are re-checked against the
  walnut squares and adjusted where a pair drops below its current ratio.
- **Radii:** `control` 12px, `card` 14px, `pill` unchanged, `board` 8px on
  desktop and 0 on a phone (the board is edge to edge there, as now).
- **Elevation:** cards lose their border and take `shadow-card`
  (`0 1px 3px` plus `0 4px 12px`, low-alpha black) in light; in dark, where
  shadows do not read, cards keep a `border` hairline. Inputs keep
  `border-strong`.
- **Typeface:** Inter variable, self-hosted through `next/font` (no request
  to Google at runtime), `font-display: swap`, with the current system stack
  as the fallback. `font-feature-settings: 'tnum'` stays on move lists and
  counts.
- **Theme switch:** the account menu sets `data-theme` on `<html>` (the
  mechanism `tokens.css` already supports) and stores the choice in a
  `theme` cookie (`system` | `light` | `dark`, one year). The root layout
  reads the cookie on the server and renders the attribute, so there is no
  flash. `system` removes the attribute.

## Architecture

### Route groups

```
src/app/
  (app)/                layout: AppShell (top bar, tabs, account menu)
    page.tsx            Today
    repertoires/...
    fide/
    coach/...
    settings/
  (focus)/              layout: no tabs
    training/
  sign-in/  welcome/  invite/   no group, unchanged
```

Moving a folder into a route group changes no URL. `ROUTES` stays as it is.

### Components (in `apps/web/src/app/shell/`)

| Unit | Does | Depends on |
| --- | --- | --- |
| `(app)/layout.tsx` | server: `requireOnboarded()`, `isCoach`, due count, theme cookie; renders `AppShell` around children | session, `todaySummary` |
| `AppShell` | top bar and, below `md`, the fixed bottom bar; content padding for the bar | `TabNav`, `AccountMenu` |
| `TabNav` | the tab list for both placements; marks the active tab from `usePathname()` with `aria-current="page"`; the due badge | `nav-tabs.ts` |
| `nav-tabs.ts` | pure: `navTabs({ isCoach, dueCount })` returns the tabs; `activeTab(pathname)` returns the tab id | `ROUTES` |
| `AccountMenu` | avatar button and its menu (a disclosure, closes on Escape and outside click, focus returns to the button) | `ThemeSwitch`, `SignOutButton` |
| `ThemeSwitch` | three-way radio group; sets the attribute and the cookie through a server action | `theme.ts` |
| `theme.ts` | pure: parse the cookie value (zod), map it to the `data-theme` attribute | `zod` |
| `PageHeader` | back link plus `h1`; one line, clamped | `next/link` |

`nav-tabs.ts` and `theme.ts` hold the decisions (which tabs, which is active,
which theme); the components only render them. The home page drops its
link row and `SignOutButton`; the `requireOnboarded()` in each page stays (a
layout does not guard a page's own data loading).

### Accessibility

- Tabs are a `<nav aria-label="Main">` list of links, not an ARIA tablist
  (they navigate). The active link has `aria-current="page"`.
- The badge count is in the link's accessible name, not only visual.
- A "Skip to content" link is the first focusable element of the shell.
- Visible focus on every control; the account menu is fully keyboard
  operable.
- Motion: the menu's open transition is off under
  `prefers-reduced-motion`.

## Error handling

- The due count is decoration: if `todaySummary` fails, the shell renders
  without the badge and the page still loads (the failure is logged).
- An unknown `theme` cookie value parses to `system`.

## Testing

- **Unit:** `nav-tabs.ts` (coach tab only for coaches; badge only when due >
  0; 99+; `activeTab` for each route family, nested coach routes, unknown
  routes), `theme.ts` (each value, garbage to `system`).
- **Component:** `TabNav` (active link has `aria-current`, accessible name
  with the count), `AccountMenu` (opens, Escape closes and returns focus,
  contains the links and sign out), `ThemeSwitch` (sets the attribute),
  `PageHeader` (back link target, title).
- **E2E:** existing journeys updated to navigate through the tabs and the
  account menu instead of the home links. New `@mobile` journey: Today, then
  Repertoires tab, open a repertoire, back via `PageHeader`, then Opponents;
  the tab bar is visible throughout and absent on `/training`.
- **Sign-off (ux-designer):** screenshots at 390px and 1280px, light and
  dark, of Today, Repertoires, a repertoire, Opponents, Coach, Settings and
  Training; a keyboard pass; a 200% zoom check; the updated contrast table in
  `docs/design/README.md`.

## Docs

- `docs/design/README.md`: the shell (navigation, layouts, `PageHeader`),
  the new token values, the refreshed contrast table, the typeface.
- `docs/owner-rulings.md`: R-218 to R-220.

## Out of scope

- Redesigning screen content (Today, training, repertoire, coach, secondary
  screens): later #381 specs.
- A per-user board colour setting (possible later, under Settings).
- Offline support (post-MVP, R-7).

## Done means

The tabs and account menu reach every area on a phone and on desktop; no
page keeps a hand-made top navigation; `/training` has no tabs; the Ocean
tokens and Inter are live with every contrast pair passing AA in both
themes; the theme switch persists without a flash; the gate is green and the
ux-designer has signed off.
