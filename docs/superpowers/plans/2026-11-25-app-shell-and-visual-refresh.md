# App Shell and Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every signed-in screen one navigation frame (bottom tabs on a phone, top bar on desktop, account menu, page headers) and the Ocean visual language (R-218 to R-220), per `docs/superpowers/specs/2026-11-25-app-shell-and-visual-refresh-design.md`.

**Architecture:** Pure decision modules (`nav-tabs.ts`, `theme.ts`) decide which tabs exist, which is active, which theme applies; thin client components render them. A server `AppShell` loads the account and the due count once per request (React `cache`) and is mounted by one tiny `layout.tsx` per tab segment plus the home page. Tokens change in `tokens.css` only, guarded by a new contrast test.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl 4, Tailwind 4 (`@theme` tokens), next/font (Inter), vitest + Testing Library (component project), Playwright (E2E).

---

## Lead decisions (refinements of the spec, recorded in the spec in Task 0)

1. **Per-segment layouts, not route groups.** Moving `coach/`, `repertoires/`, `fide/`, `settings/` into `(app)/` would rewrite relative imports in 123 files plus the feature tests. Instead `repertoires/layout.tsx`, `coach/layout.tsx`, `fide/layout.tsx`, `settings/layout.tsx` each render `<AppShell>`, and the home page renders it itself. `/training`, `/sign-in`, `/welcome`, `/invite` get no shell by having no such layout. No URL changes.
2. **One `<nav>` element.** The tab list is rendered once; CSS places it fixed at the bottom below `md` and inline in the top bar from `md`. No duplicate links for tests or screen readers.
3. **Phone inner pages:** the shell's top row (wordmark, avatar) shows only on a tab's own page (`/`, `/repertoires`, `/fide`, `/coach`). On an inner page the page's own header row is the only top row; `PageHeader` carries the avatar menu on a phone (read from a shell context). Board pages keep their existing compact `HeaderFrame` (board stays high) with the back target fixed.
4. **Theme cookie is written in the browser** (`document.cookie`): it is a non-secret preference, so no server action. The root layout reads it on the server, so the first paint has the right theme.
5. **The due count** comes from `todaySummary`, wrapped in React `cache` so the home page and the shell share one query per request.
6. **Cards:** a shared `CARD` class (`src/app/surfaces.ts`) with a new `card-edge` token (transparent in light, a hairline in dark) replaces the bordered surface cards.

## File structure

| File | Responsibility |
| --- | --- |
| `src/app/tokens.css` (modify) | Ocean values, radii, shadow, `accent-subtle`, `card-edge`, `container-content`, `spacing-tabbar`, font var |
| `src/app/tokens.test.ts` (create) | parses `tokens.css`, asserts every WCAG pair in both themes |
| `src/lib/theme.ts` (+ test) | `Theme`, `THEME_COOKIE`, `parseTheme`, `themeAttribute` |
| `src/app/layout.tsx` (modify) | Inter, `data-theme` from cookie, `viewport-fit=cover` |
| `src/app/shell/nav-tabs.ts` (+ test) | `navTabs`, `activeTab`, `isTabRoot`, `dueBadge` |
| `src/app/shell/shell-context.tsx` | client context: account id, display name, theme |
| `src/app/shell/nav-icons.tsx` | four inline SVG icons |
| `src/app/shell/tab-nav.tsx` (+ test) | the `<nav>` |
| `src/app/shell/theme-switch.tsx` (+ test) | System / Light / Dark radio group |
| `src/app/shell/account-menu.tsx` (+ test) | avatar button and menu |
| `src/app/shell/page-header.tsx` (+ test) | back link, `h1`, phone avatar |
| `src/app/shell/top-bar.tsx` | wordmark, nav, avatar; hides its row on phone inner pages |
| `src/app/shell/app-shell.tsx` | server: loads shell data, renders provider, top bar, content |
| `src/server/shell.ts` (+ test) | `shellData()`: account, isCoach, due, theme |
| `src/server/training.ts` (modify) | `todaySummary` wrapped in `cache` |
| `src/app/{repertoires,coach,fide,settings}/layout.tsx` | mount `AppShell` |
| `src/app/surfaces.ts` | `CARD`, `CONTENT` class names |
| `src/i18n/messages/en.json` (modify) | `nav` namespace; drop unused `app` keys |
| `e2e/support/nav.ts`, `e2e/shell.spec.ts` | tab and menu helpers; the new @mobile journey |
| `docs/design/README.md` (modify) | shell, tokens, contrast table, typeface |

All paths below are relative to `apps/web/` unless they start with `docs/`.

Commands used throughout (run from the repo root):

- One component test file: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts <path>`
- Typecheck: `pnpm --filter @mychess/web typecheck`
- Lint a file: `pnpm exec eslint --max-warnings=0 <path>`

---

### Task 0: Record the lead decisions in the spec

**Files:**
- Modify: `docs/superpowers/specs/2026-11-25-app-shell-and-visual-refresh-design.md` (section "Architecture", subsection "Route groups")

- [ ] **Step 1: Replace the "Route groups" subsection**

Replace the whole `### Route groups` subsection (heading, tree and the sentence after it) with:

```markdown
### Where the shell is mounted

Lead decision (plan, 2026-11-25): one small `layout.tsx` per tab segment
(`repertoires/`, `coach/`, `fide/`, `settings/`) renders `AppShell`, and the
home page renders it itself. Route groups would have moved four folders and
rewritten relative imports in 123 files for the same result. `/training`,
`/sign-in`, `/welcome` and `/invite` have no such layout, so no shell. No URL
changes; `ROUTES` stays as it is.

On a phone the shell's top row (wordmark, avatar) shows only on a tab's own
page; an inner page's own header row is the only top row, and `PageHeader`
carries the avatar there. Board pages keep their compact header so the board
stays high. The theme cookie is written by the browser (a non-secret
preference); the root layout reads it on the server.
```

Also in the components table change the first row's unit from `(app)/layout.tsx` to `AppShell (server)` and the `ThemeSwitch` row's "through a server action" to "in the browser".

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-25-app-shell-and-visual-refresh-design.md
git commit -m "docs(ux): mount the shell per segment, not through route groups (#381)"
```

---

### Task 1: Ocean tokens and the contrast test

**Files:**
- Create: `src/app/tokens.test.ts`
- Modify: `src/app/tokens.css`

- [ ] **Step 1: Write the contrast test**

```ts
// src/app/tokens.test.ts
// Every text, control and focus pair in docs/design/README.md's contrast
// table, read from tokens.css itself, in both themes (WCAG 2.2 AA).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('./tokens.css', import.meta.url)),
  'utf8',
);

type Pair = readonly [light: string, dark: string];

/** `--color-<name>: light-dark(#xxxxxx, #yyyyyy)` or a single hex. */
function token(name: string): Pair {
  const both = new RegExp(
    `--color-${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`,
    'i',
  ).exec(CSS);
  if (both?.[1] !== undefined && both[2] !== undefined)
    return [both[1], both[2]];
  const one = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(CSS);
  if (one?.[1] === undefined) throw new Error(`no token ${name}`);
  return [one[1], one[1]];
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};

const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = 4.5;
const UI = 3;

const PAIRS: readonly (readonly [fg: string, bg: string, min: number])[] = [
  ['fg', 'bg', TEXT],
  ['fg', 'surface', TEXT],
  ['fg-muted', 'bg', TEXT],
  ['fg-muted', 'surface', TEXT],
  ['accent', 'bg', TEXT],
  ['accent', 'surface', TEXT],
  ['accent', 'accent-subtle', TEXT],
  ['accent-fg', 'accent', TEXT],
  ['focus', 'bg', UI],
  ['focus', 'surface', UI],
  ['border-strong', 'bg', UI],
  ['border-strong', 'surface', UI],
  ...(['success', 'error', 'due', 'learned'] as const).flatMap(
    (s) =>
      [
        [s, 'bg', TEXT],
        [s, 'surface', TEXT],
        [s, `${s}-subtle`, TEXT],
        ['on-state', s, TEXT],
      ] as const,
  ),
];

describe('tokens.css contrast (WCAG 2.2 AA)', () => {
  it.each(PAIRS)('%s on %s reaches %d:1 in both themes', (fg, bg, min) => {
    const [fgLight, fgDark] = token(fg);
    const [bgLight, bgDark] = token(bg);
    expect(ratio(fgLight, bgLight)).toBeGreaterThanOrEqual(min);
    expect(ratio(fgDark, bgDark)).toBeGreaterThanOrEqual(min);
  });

  it('measures black on white as 21:1 and a colour on itself as 1:1', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#0b63c5', '#0b63c5')).toBe(1);
  });
});
```

- [ ] **Step 2: Run it: it must fail on `accent-subtle`**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/tokens.test.ts`
Expected: FAIL with `no token accent-subtle` (every other pair passes on today's tokens).

- [ ] **Step 3: Change the tokens**

In `src/app/tokens.css`, inside `@theme`, set these values (leave every state token, `on-state`, `skipped` and the piece tokens unchanged):

```css
  --color-bg: light-dark(#f4f5f8, #0f1218); /* page */
  --color-surface: light-dark(#ffffff, #181d26); /* cards, panels, sheets */
  --color-sunken: light-dark(#e9ecf2, #0b0d12); /* wells, skeletons */
  --color-border: light-dark(#dce0e8, #2c3240);
  --color-border-strong: light-dark(#7d8597, #6b7385); /* inputs, 3:1 */
  --color-fg: light-dark(#141a26, #e6e9f0); /* body text */
  --color-fg-muted: light-dark(#566075, #9aa3b5); /* secondary text */
  /* A card's edge: none in light (the shadow lifts it), a hairline in dark
     where shadows do not read (R-219). */
  --color-card-edge: light-dark(transparent, #2c3240);

  /* ---- Brand / interactive (Ocean, R-220) ---- */
  --color-accent: light-dark(#0b63c5, #6aaeff); /* primary buttons, links */
  --color-accent-fg: light-dark(#ffffff, #06142a); /* text on accent */
  --color-accent-subtle: light-dark(#e3eefb, #16263d); /* avatar, active tint */
  --color-focus: light-dark(#0b63c5, #6aaeff); /* focus ring off the board */
```

Replace the font, radii and shadow lines:

```css
  --font-sans:
    var(--font-inter), system-ui, -apple-system, 'Segoe UI', Roboto,
    'Noto Sans', 'Helvetica Neue', Arial, sans-serif;
```

```css
  --radius-control: 0.75rem; /* buttons, inputs, chips */
  --radius-card: 0.875rem; /* cards, panels, sheets */
  --radius-board: 0.5rem; /* the board's outer corners (desktop) */
```

```css
  --shadow-card: 0 1px 3px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04);
```

Add after `--spacing-panel`:

```css
  --spacing-tabbar: 3.5rem; /* 56px: the phone tab bar and the desktop top bar */

  /* ---- Containers ---- */
  --container-content: 65rem; /* 1040px: list and form pages (max-w-content) */
```

In `@theme static`, set the board squares (Ocean's walnut, R-220):

```css
  --color-board-light: light-dark(#f0d9b5, #d7c2a0);
  --color-board-dark: light-dark(#b58863, #946f4f);
```

Update the header comment of the `Surfaces` block to say "Ocean (R-220)".

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/tokens.test.ts`
Expected: PASS. If a pair fails, darken (light) or lighten (dark) the failing foreground in steps of about 5% lightness until it passes (the spec allows this without the owner) and note the final value for Task 13.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/tokens.css apps/web/src/app/tokens.test.ts
git commit -m "feat(web): Ocean tokens with a contrast test over every AA pair (#381, R-219, R-220)"
```

---

### Task 2: Theme preference module

**Files:**
- Create: `src/lib/theme.ts`, `src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/theme.test.ts
import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, parseTheme, themeAttribute } from './theme';

describe('parseTheme', () => {
  it.each(['system', 'light', 'dark'] as const)('keeps %s', (value) => {
    expect(parseTheme(value)).toBe(value);
  });

  it.each([undefined, '', 'sepia', 'LIGHT'])('reads %s as system', (value) => {
    expect(parseTheme(value)).toBe('system');
  });
});

describe('themeAttribute', () => {
  it('sets data-theme only for a chosen theme', () => {
    expect(themeAttribute('system')).toBeUndefined();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

it('names the cookie theme', () => {
  expect(THEME_COOKIE).toBe('theme');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/lib/theme.test.ts`
Expected: FAIL, cannot resolve `./theme`.

- [ ] **Step 3: Implement**

```ts
// src/lib/theme.ts
/**
 * The colour theme a person picks in the account menu (#381): the system's,
 * or light or dark whatever the system says. Kept in a cookie so the server
 * renders the right theme on the first paint (tokens.css reads
 * `data-theme` on <html>).
 */
import { z } from 'zod';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The cookie that holds the choice; a year long, readable by the page. */
export const THEME_COOKIE = 'theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const themeSchema = z.enum(THEMES).catch('system');

/** A cookie value as a theme; anything unknown is the system's. */
export const parseTheme = (value: string | undefined): Theme =>
  themeSchema.parse(value);

/** The `data-theme` attribute for a theme: none follows the system. */
export const themeAttribute = (theme: Theme): 'light' | 'dark' | undefined =>
  theme === 'system' ? undefined : theme;
```

- [ ] **Step 4: Run it to see it pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme.ts apps/web/src/lib/theme.test.ts
git commit -m "feat(web): the theme preference, parsed from its cookie (#381)"
```

---

### Task 3: Root layout: Inter, theme attribute, safe-area viewport

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Rewrite the layout**

```tsx
import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { BRAND } from '../lib/brand';
import { THEME_COOKIE, parseTheme, themeAttribute } from '../lib/theme';
import './globals.css';

// Inter (R-219), downloaded at build time and served from this site: no
// request to Google at runtime. tokens.css puts --font-inter first in
// --font-sans, with the system stack behind it.
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

// The brand is one name in every language (R-170). The manifest
// (manifest.ts) and the icons beside this file are linked by Next itself.
export const metadata: Metadata = {
  title: BRAND,
  applicationName: BRAND,
  appleWebApp: { title: BRAND },
};

// The phone tab bar sits on the home indicator's inset (#381).
export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<JSX.Element> {
  const locale = await getLocale();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang={locale}
      data-theme={themeAttribute(theme)}
      className={inter.variable}
    >
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

(`globals.css` already gives `body` the `bg`, `fg` and `--font-sans` tokens, so Inter applies through the token.)

- [ ] **Step 2: Build to prove the font resolves**

Run: `pnpm --filter @mychess/web build`
Expected: build succeeds; `.next/static/media/` contains `*.woff2` files.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): Inter, the theme from its cookie and the safe-area viewport (#381, R-219)"
```

---

### Task 4: Navigation decisions (`nav-tabs.ts`)

**Files:**
- Create: `src/app/shell/nav-tabs.ts`, `src/app/shell/nav-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/shell/nav-tabs.test.ts
import { describe, expect, it } from 'vitest';
import { activeTab, dueBadge, isTabRoot, navTabs } from './nav-tabs';

describe('navTabs', () => {
  it('gives a player Today, Repertoires and Opponents', () => {
    expect(navTabs({ isCoach: false }).map((t) => [t.id, t.href])).toEqual([
      ['today', '/'],
      ['repertoires', '/repertoires'],
      ['opponents', '/fide'],
    ]);
  });

  it('adds Coach last for a coach', () => {
    expect(navTabs({ isCoach: true }).map((t) => t.id)).toEqual([
      'today',
      'repertoires',
      'opponents',
      'coach',
    ]);
  });
});

describe('activeTab', () => {
  it.each([
    ['/', 'today'],
    ['/repertoires', 'repertoires'],
    ['/repertoires/import', 'repertoires'],
    ['/repertoires/assigned/abc', 'repertoires'],
    ['/fide', 'opponents'],
    ['/coach', 'coach'],
    ['/coach/players/p1/progress/r1', 'coach'],
  ] as const)('%s is %s', (path, tab) => {
    expect(activeTab(path)).toBe(tab);
  });

  it.each(['/settings', '/training', '/repertoiresx', '/coaching'])(
    '%s belongs to no tab',
    (path) => {
      expect(activeTab(path)).toBeNull();
    },
  );
});

describe('isTabRoot', () => {
  it.each(['/', '/repertoires', '/fide', '/coach'])('%s is a tab', (path) => {
    expect(isTabRoot(path)).toBe(true);
  });

  it.each(['/settings', '/repertoires/import', '/coach/groups/g1'])(
    '%s is an inner page',
    (path) => {
      expect(isTabRoot(path)).toBe(false);
    },
  );
});

describe('dueBadge', () => {
  it('shows nothing when nothing is due', () => {
    expect(dueBadge(0)).toBeNull();
  });

  it('shows the count up to 99, then 99+', () => {
    expect(dueBadge(1)).toBe('1');
    expect(dueBadge(99)).toBe('99');
    expect(dueBadge(100)).toBe('99+');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/shell/nav-tabs.test.ts`
Expected: FAIL, cannot resolve `./nav-tabs`.

- [ ] **Step 3: Implement**

```ts
// src/app/shell/nav-tabs.ts
/**
 * The main navigation (R-218): which tabs an account has, which one a page
 * belongs to, and the Today tab's due badge. The tab components only render
 * what these decide.
 */
import { ROUTES } from '../../lib/routes';

export type TabId = 'today' | 'repertoires' | 'opponents' | 'coach';

export interface NavTab {
  readonly id: TabId;
  readonly href: string;
}

const TABS: readonly NavTab[] = [
  { id: 'today', href: ROUTES.home },
  { id: 'repertoires', href: ROUTES.repertoires },
  { id: 'opponents', href: ROUTES.fideSearch },
  { id: 'coach', href: ROUTES.coach },
];

/** The tabs in order; Coach only for an account with the coach capability. */
export const navTabs = ({
  isCoach,
}: {
  readonly isCoach: boolean;
}): readonly NavTab[] => TABS.filter((t) => isCoach || t.id !== 'coach');

const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/** The tab a path belongs to, or null (settings, training). */
export function activeTab(path: string): TabId | null {
  if (path === ROUTES.home) return 'today';
  return TABS.find((t) => t.id !== 'today' && within(path, t.href))?.id ?? null;
}

/** A tab's own page, where the phone shows the wordmark row. */
export const isTabRoot = (path: string): boolean =>
  TABS.some((t) => t.href === path);

const BADGE_MAX = 99;

/** The Today badge's text, or null when nothing is due. */
export const dueBadge = (due: number): string | null =>
  due <= 0 ? null : due > BADGE_MAX ? `${String(BADGE_MAX)}+` : String(due);
```

- [ ] **Step 4: Run it to see it pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shell/nav-tabs.ts apps/web/src/app/shell/nav-tabs.test.ts
git commit -m "feat(web): the main navigation's tabs, active tab and due badge (#381, R-218)"
```

---

### Task 5: Catalogue keys

**Files:**
- Modify: `src/i18n/messages/en.json`

- [ ] **Step 1: Add the `nav` namespace** (after `"app"`)

```json
  "nav": {
    "label": "Main",
    "skip": "Skip to content",
    "today": "Today",
    "todayDue": "Today, {count} due",
    "repertoires": "Repertoires",
    "opponents": "Opponents",
    "coach": "Coach",
    "back": "Back to {parent}",
    "account": {
      "open": "Account menu",
      "settings": "Settings",
      "myCoaches": "My coaches",
      "theme": "Theme",
      "themeSystem": "System",
      "themeLight": "Light",
      "themeDark": "Dark"
    }
  },
```

Do not remove the `app` keys yet; Task 10 removes the ones that become unused.

- [ ] **Step 2: Typecheck** (the catalogue is typed from the JSON)

Run: `pnpm --filter @mychess/web typecheck` — Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/i18n/messages/en.json
git commit -m "feat(web): catalogue keys for the main navigation (#381)"
```

---

### Task 6: Shell context, icons and `TabNav`

**Files:**
- Create: `src/app/shell/shell-context.tsx`, `src/app/shell/nav-icons.tsx`, `src/app/shell/tab-nav.tsx`, `src/app/shell/tab-nav.test.tsx`

- [ ] **Step 1: Shell context**

```tsx
// src/app/shell/shell-context.tsx
'use client';

import { createContext, useContext, type JSX, type ReactNode } from 'react';
import type { Theme } from '../../lib/theme';

/** What the shell's client parts need about the session account. */
export interface ShellAccount {
  readonly accountId: string;
  readonly displayName: string;
  readonly theme: Theme;
}

const ShellContext = createContext<ShellAccount | null>(null);

export function ShellProvider({
  value,
  children,
}: {
  readonly value: ShellAccount;
  readonly children: ReactNode;
}): JSX.Element {
  return <ShellContext value={value}>{children}</ShellContext>;
}

/** The shell's account; null outside the shell (training, sign-in). */
export const useShellAccount = (): ShellAccount | null =>
  useContext(ShellContext);
```

- [ ] **Step 2: Icons**

```tsx
// src/app/shell/nav-icons.tsx
// The tab icons: 24px line icons in currentColor, decorative (the label
// names the tab).
import type { JSX } from 'react';
import type { TabId } from './nav-tabs';

const PATHS: Record<TabId, string> = {
  // a calendar day
  today: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4',
  // an open book
  repertoires: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5m0-13c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5m0-13v13',
  // two people
  opponents: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6m1-9a3 3 0 1 0 0-6m2 15c0-2.6-1.6-4.8-4-5.6',
  // a person at a table
  coach: 'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 10c0-3.9 3.1-7 7-7s7 3.1 7 7M4 20h16',
};

export function NavIcon({ tab }: { readonly tab: TabId }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[tab]} />
    </svg>
  );
}
```

The ux-designer may redraw any icon at sign-off.

- [ ] **Step 3: Write the failing `TabNav` test**

```tsx
// src/app/shell/tab-nav.test.tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { TabNav } from './tab-nav';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));

const show = (props: { isCoach: boolean; due: number }, at: string) => {
  path.current = at;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TabNav {...props} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('navigation', { name: 'Main' });
};

describe('TabNav', () => {
  it('lists a player three tabs, the current one marked', () => {
    const nav = show({ isCoach: false, due: 0 }, '/repertoires/import');
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Today',
      'Repertoires',
      'Opponents',
    ]);
    const current = (name: string) =>
      within(nav).getByRole('link', { name }).getAttribute('aria-current');
    expect(current('Repertoires')).toBe('page');
    expect(current('Today')).toBeNull();
  });

  it('adds Coach for a coach', () => {
    const nav = show({ isCoach: true, due: 0 }, '/coach/groups/g1');
    const coach = within(nav).getByRole('link', { name: 'Coach' });
    expect(coach.getAttribute('href')).toBe('/coach');
    expect(coach.getAttribute('aria-current')).toBe('page');
  });

  it('names the due count on Today, capped at 99+ on the badge', () => {
    const nav = show({ isCoach: false, due: 120 }, '/');
    const today = within(nav).getByRole('link', { name: 'Today, 120 due' });
    expect(today.textContent).toContain('99+');
  });
});
```

(The suite has no jest-dom; assertions read attributes directly, as the existing tests do.)

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/shell/tab-nav.test.tsx`
Expected: FAIL, cannot resolve `./tab-nav`.

- [ ] **Step 5: Implement `TabNav`**

```tsx
// src/app/shell/tab-nav.tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { NavIcon } from './nav-icons';
import { activeTab, dueBadge, navTabs, type NavTab } from './nav-tabs';

// One <nav> for both placements (lead decision 2): fixed to the bottom of a
// phone, over the home indicator's inset; inline in the top bar from md.
const NAV =
  'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0';
const LIST = 'flex md:gap-2';
const LINK =
  'relative flex min-h-tabbar min-w-touch flex-1 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium text-fg-muted md:flex-row md:gap-2 md:text-base aria-[current=page]:text-accent md:aria-[current=page]:shadow-[inset_0_-2px_0_var(--color-accent)]';
const BADGE =
  'absolute top-1 left-[calc(50%+0.5rem)] rounded-pill bg-due px-1.5 text-xs leading-5 font-semibold text-on-state tabular-nums md:static';

function Tab({
  tab,
  current,
  due,
}: {
  readonly tab: NavTab;
  readonly current: boolean;
  readonly due: number;
}): JSX.Element {
  const t = useTranslations('nav');
  const badge = tab.id === 'today' ? dueBadge(due) : null;
  return (
    <li className="flex flex-1 md:flex-none">
      <Link
        href={tab.href}
        className={LINK}
        aria-current={current ? 'page' : undefined}
        aria-label={badge === null ? undefined : t('todayDue', { count: due })}
      >
        <NavIcon tab={tab.id} />
        <span>{t(tab.id)}</span>
        {badge === null ? null : (
          <span aria-hidden="true" className={BADGE}>
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}

/** The main navigation (R-218). */
export function TabNav({
  isCoach,
  due,
}: {
  readonly isCoach: boolean;
  readonly due: number;
}): JSX.Element {
  const t = useTranslations('nav');
  const current = activeTab(usePathname());
  return (
    <nav aria-label={t('label')} className={NAV}>
      <ul className={LIST}>
        {navTabs({ isCoach }).map((tab) => (
          <Tab key={tab.id} tab={tab} current={tab.id === current} due={due} />
        ))}
      </ul>
    </nav>
  );
}
```

`min-h-tabbar` comes from the `--spacing-tabbar` token (Task 1). If the `aria-[current=page]` or the arbitrary inset shadow variant does not compile under the lint rules, use `data-current` plus a `data-[current]:` variant instead.

- [ ] **Step 6: Run it to see it pass**

Same command as Step 4. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/shell
git commit -m "feat(web): the tab navigation, one nav for phone and desktop (#381, R-218)"
```

---

### Task 7: `ThemeSwitch` and `AccountMenu`

**Files:**
- Create: `src/app/shell/theme-switch.tsx`, `src/app/shell/theme-switch.test.tsx`, `src/app/shell/account-menu.tsx`, `src/app/shell/account-menu.test.tsx`

- [ ] **Step 1: Write the failing `ThemeSwitch` test**

```tsx
// src/app/shell/theme-switch.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { ThemeSwitch } from './theme-switch';

const show = (initial: 'system' | 'light' | 'dark') =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ThemeSwitch initial={initial} />
    </NextIntlClientProvider>,
  );

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.cookie = 'theme=; max-age=0; path=/';
});

describe('ThemeSwitch', () => {
  it('checks the current theme', () => {
    show('dark');
    expect(
      (screen.getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('applies a chosen theme to the page and remembers it', () => {
    show('system');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('theme=light');
  });

  it('follows the system again when System is chosen', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    show('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.cookie).toContain('theme=system');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/shell/theme-switch.test.tsx`
Expected: FAIL, cannot resolve `./theme-switch`.

- [ ] **Step 3: Implement `ThemeSwitch`**

```tsx
// src/app/shell/theme-switch.tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';
import {
  THEMES,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeAttribute,
  type Theme,
} from '../../lib/theme';

const LABEL = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
} as const;

/** Applies a theme now and keeps it for the next visit (lead decision 4). */
function apply(theme: Theme): void {
  const attribute = themeAttribute(theme);
  const root = document.documentElement;
  if (attribute === undefined) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', attribute);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${String(THEME_COOKIE_MAX_AGE)}; samesite=lax`;
}

/** System, light or dark (#381). */
export function ThemeSwitch({
  initial,
}: {
  readonly initial: Theme;
}): JSX.Element {
  const t = useTranslations('nav.account');
  const [theme, setTheme] = useState(initial);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="px-3 text-sm text-fg-muted">{t('theme')}</legend>
      <div className="flex gap-1 px-2">
        {THEMES.map((value) => (
          <label
            key={value}
            className="flex min-h-touch flex-1 cursor-pointer items-center justify-center rounded-control px-2 text-sm has-checked:bg-accent-subtle has-checked:font-semibold has-checked:text-accent has-focus-visible:ring-2 has-focus-visible:ring-focus"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => {
                setTheme(value);
                apply(value);
              }}
              className="sr-only"
            />
            {t(LABEL[value])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run it to see it pass** (same command). Expected: PASS.

- [ ] **Step 5: Write the failing `AccountMenu` test**

```tsx
// src/app/shell/account-menu.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { AccountMenu } from './account-menu';
import { ShellProvider } from './shell-context';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider
        value={{ accountId: 'a1', displayName: 'Gabija Navickaitė', theme: 'system' }}
      >
        <AccountMenu />
        <button type="button">outside</button>
      </ShellProvider>
    </NextIntlClientProvider>,
  );

const opener = () => screen.getByRole('button', { name: 'Account menu' });

describe('AccountMenu', () => {
  it('shows the initials and keeps the menu closed at first', () => {
    show();
    expect(opener().textContent).toBe('GN');
    expect(opener().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('opens on the avatar with the name, the links, the theme and sign out', () => {
    show();
    fireEvent.click(opener());
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Gabija Navickaitė')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Settings' }).getAttribute('href'),
    ).toBe('/settings');
    expect(
      screen.getByRole('link', { name: 'My coaches' }).getAttribute('href'),
    ).toBe('/settings#coaches');
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('closes on Escape and gives focus back to the avatar', () => {
    show();
    fireEvent.click(opener());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes on a press outside it', () => {
    show();
    fireEvent.click(opener());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('renders nothing outside the shell', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <AccountMenu />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/shell/account-menu.test.tsx`
Expected: FAIL, cannot resolve `./account-menu`.

- [ ] **Step 7: Implement `AccountMenu`**

```tsx
// src/app/shell/account-menu.tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { ROUTES } from '../../lib/routes';
import { SignOutButton } from '../sign-out-button';
import { useShellAccount } from './shell-context';
import { ThemeSwitch } from './theme-switch';

/** Up to two initials: first and last word of the display name. */
export const initials = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toLocaleUpperCase();
};

const AVATAR =
  'flex size-touch items-center justify-center rounded-pill bg-accent-subtle text-sm font-semibold text-accent focus-visible:ring-2 focus-visible:ring-focus';
const PANEL =
  'absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-card border border-card-edge bg-surface py-2 shadow-card';
const ITEM = 'flex min-h-touch items-center px-3 text-fg hover:bg-sunken';

/** Closes the menu on Escape or a press outside it. */
function useDismiss(
  open: boolean,
  close: (refocus: boolean) => void,
  root: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(true);
    };
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close, root]);
}

/** The avatar and its menu (R-218); nothing outside the shell. */
export function AccountMenu(): JSX.Element | null {
  const account = useShellAccount();
  const t = useTranslations('nav.account');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  useDismiss(open, close, root);
  if (account === null) return null;
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t('open')}
        aria-expanded={open}
        aria-haspopup="true"
        className={AVATAR}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{initials(account.displayName)}</span>
      </button>
      {open ? (
        <div className={PANEL}>
          <p className="px-3 py-2 font-semibold">{account.displayName}</p>
          <Link href={ROUTES.settings} className={ITEM}>
            {t('settings')}
          </Link>
          <Link href={ROUTES.myCoaches} className={ITEM}>
            {t('myCoaches')}
          </Link>
          <ThemeSwitch initial={account.theme} />
          <div className="px-3 pt-2">
            <SignOutButton accountId={account.accountId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

The button's accessible name is its `aria-label` ("Account menu"); the test reads the initials through `textContent`, which includes the `aria-hidden` span. The menu opens without animation, which is the reduced-motion-safe default.

Add to the test file a direct test of the exported `initials`:

```tsx
import { initials } from './account-menu';

it.each([
  ['Gabija Navickaitė', 'GN'],
  ['Rokas', 'R'],
  ['  ąžuolas  jonas ', 'ĄJ'],
])('initials of %j are %s', (name, expected) => {
  expect(initials(name)).toBe(expected);
});
```

- [ ] **Step 8: Run it to see it pass** (same command as Step 6). Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/shell
git commit -m "feat(web): the account menu with the theme switch and sign out (#381, R-218)"
```

---

### Task 8: `PageHeader`

**Files:**
- Create: `src/app/shell/page-header.tsx`, `src/app/shell/page-header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/shell/page-header.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { PageHeader } from './page-header';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('PageHeader', () => {
  it('links back to the named parent and titles the page', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader
          back={{ href: '/repertoires', parent: 'Repertoires' }}
          title="Import PGN"
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Import PGN',
    );
  });

  it('titles a tab page without a way back', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader title="Repertoires" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/app/shell/page-header.test.tsx`
Expected: FAIL, cannot resolve `./page-header`.

- [ ] **Step 3: Implement**

```tsx
// src/app/shell/page-header.tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { AccountMenu } from './account-menu';

/**
 * A page's title row (#381). An inner page names its parent and links to
 * it by href (a shared link still has a way up); on a phone the row also
 * carries the account menu, because the shell's top row is hidden there.
 */
export function PageHeader({
  back,
  title,
  children,
}: {
  readonly back?: { readonly href: string; readonly parent: string };
  readonly title: string;
  /** A line under the title (an intro), if any. */
  readonly children?: ReactNode;
}): JSX.Element {
  const t = useTranslations('nav');
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {back === undefined ? null : (
          <Link
            href={back.href}
            aria-label={t('back', { parent: back.parent })}
            className="-ml-2 flex size-touch shrink-0 items-center justify-center rounded-control text-accent hover:bg-sunken"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
        )}
        <h1 className="line-clamp-1 flex-1 text-2xl font-bold sm:text-3xl">
          {title}
        </h1>
        {back === undefined ? null : (
          <div className="md:hidden">
            <AccountMenu />
          </div>
        )}
      </div>
      {children}
    </header>
  );
}
```

- [ ] **Step 4: Run it to see it pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/shell/page-header.tsx apps/web/src/app/shell/page-header.test.tsx
git commit -m "feat(web): PageHeader, one way back and title for every inner page (#381)"
```

---

### Task 9: `AppShell`, shell data and the segment layouts

**Files:**
- Modify: `src/server/training.ts` (wrap `todaySummary`)
- Create: `src/server/shell.ts`, `src/app/shell/top-bar.tsx`, `src/app/shell/app-shell.tsx`, `src/app/surfaces.ts`
- Create: `src/app/repertoires/layout.tsx`, `src/app/coach/layout.tsx`, `src/app/fide/layout.tsx`, `src/app/settings/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: One due-count query per request**

In `src/server/training.ts`, rename the existing `export async function todaySummary` to `async function loadTodaySummary` (keep its doc comment) and export a cached one directly under it:

```ts
import { cache } from 'react';
// ...
/**
 * todaySummary once per request: home and the shell's badge share it.
 * `cache` matches arguments by identity, which holds: `getAccount`
 * (server/session.ts) is itself request-cached, so every caller in a
 * request passes the same Account object.
 */
export const todaySummary = cache(loadTodaySummary);
```

Run `pnpm --filter @mychess/web exec vitest run --config vitest.component.config.ts src/server/training.test.ts` — Expected: PASS (React `cache` outside a request simply calls through).

- [ ] **Step 2: Shell data**

```ts
// src/server/shell.ts
import 'server-only';
import { isCoach } from '@mychess/domain';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme, type Theme } from '../lib/theme';
import { requireOnboarded } from './session';
import { todaySummary } from './training';

export interface ShellData {
  readonly accountId: string;
  readonly displayName: string;
  readonly isCoach: boolean;
  /** Due moves for the Today badge; 0 when the count failed. */
  readonly due: number;
  readonly theme: Theme;
}

/** The badge is decoration: a failed count shows no badge, not an error. */
async function dueCount(
  account: Awaited<ReturnType<typeof requireOnboarded>>,
): Promise<number> {
  try {
    return (await todaySummary(account)).due;
  } catch (error) {
    console.error('shell: due count failed', error);
    return 0;
  }
}

/** What the app shell shows about the session account (#381). */
export async function shellData(): Promise<ShellData> {
  const account = await requireOnboarded();
  return {
    accountId: account.id,
    displayName: account.displayName,
    isCoach: isCoach(account),
    due: await dueCount(account),
    theme: parseTheme((await cookies()).get(THEME_COOKIE)?.value),
  };
}
```

If the codebase has a logger module (grep `src/server` for `logger`), use it instead of `console.error`. Add `src/server/shell.test.ts` mirroring how `src/server/training.test.ts` mocks `./session` and `next/headers`: assert (a) a coach account gives `isCoach: true`, (b) a throwing `todaySummary` gives `due: 0`, (c) a `theme=dark` cookie gives `theme: 'dark'` and garbage gives `'system'`.

- [ ] **Step 3: Surfaces**

```ts
// src/app/surfaces.ts
// Shared surface class names (R-219): a card lifted by its shadow (a
// hairline edge only in dark, the card-edge token), and the content column
// of list and form pages (max 1040px).

export const CARD = 'rounded-card border border-card-edge bg-surface shadow-card';

export const CONTENT =
  'mx-auto flex w-full max-w-content flex-col px-gutter py-6 sm:px-gutter-wide sm:py-8';
```

- [ ] **Step 4: Top bar**

```tsx
// src/app/shell/top-bar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';
import { BRAND } from '../../lib/brand';
import { ROUTES } from '../../lib/routes';
import { AccountMenu } from './account-menu';
import { isTabRoot } from './nav-tabs';
import { TabNav } from './tab-nav';

/**
 * The wordmark, the tabs and the avatar. On a phone the row shows only on
 * a tab's own page (lead decision 3) and the tabs sit fixed at the bottom;
 * from md it is one sticky bar.
 */
export function TopBar({
  isCoach,
  due,
}: {
  readonly isCoach: boolean;
  readonly due: number;
}): JSX.Element {
  const root = isTabRoot(usePathname());
  const row = root ? 'flex' : 'hidden md:flex';
  return (
    <header className="relative z-20 bg-surface md:sticky md:top-0 md:shadow-card">
      <div
        className={`${row} mx-auto h-tabbar max-w-content items-center justify-between gap-4 px-gutter sm:px-gutter-wide`}
      >
        <Link
          href={ROUTES.home}
          className="text-lg font-bold tracking-tight text-fg"
        >
          {BRAND}
        </Link>
        <AccountMenu />
      </div>
      <TabNav isCoach={isCoach} due={due} />
    </header>
  );
}
```

`TabNav` is rendered once (lead decision 2). Extend its `NAV` class from Task 6 with the desktop placement, replacing `md:static`:
`md:absolute md:inset-y-0 md:left-1/2 md:w-fit md:-translate-x-1/2`, and `LIST` with `md:h-full`. The nav box is only as wide as its tabs, so the wordmark and avatar either side stay clickable. Check at 1280px that the tabs are centred in the bar and at 390px that they sit fixed at the bottom.

- [ ] **Step 5: App shell**

```tsx
// src/app/shell/app-shell.tsx
import { getTranslations } from 'next-intl/server';
import type { JSX, ReactNode } from 'react';
import { shellData } from '../../server/shell';
import { ShellProvider } from './shell-context';
import { TopBar } from './top-bar';

function SkipLink({ label }: { readonly label: string }): JSX.Element {
  return (
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:p-3"
    >
      {label}
    </a>
  );
}

/**
 * The frame of every signed-in page but training (R-218): the skip link,
 * the top bar with the tabs and the account menu, and the page. On a phone
 * the page is padded above the fixed tab bar; --shell-chrome tells
 * full-height pages how much of the viewport the shell takes.
 */
export async function AppShell({
  children,
}: {
  readonly children: ReactNode;
}): Promise<JSX.Element> {
  const [data, t] = await Promise.all([shellData(), getTranslations('nav')]);
  return (
    <ShellProvider
      value={{
        accountId: data.accountId,
        displayName: data.displayName,
        theme: data.theme,
      }}
    >
      <SkipLink label={t('skip')} />
      <TopBar isCoach={data.isCoach} due={data.due} />
      <div
        id="content"
        className="[--shell-chrome:calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] pb-[var(--shell-chrome)] md:[--shell-chrome:var(--spacing-tabbar)] md:pb-0"
      >
        {children}
      </div>
    </ShellProvider>
  );
}
```

- [ ] **Step 6: Segment layouts**

Create the same file four times, in `src/app/repertoires/layout.tsx`, `src/app/coach/layout.tsx`, `src/app/fide/layout.tsx` and `src/app/settings/layout.tsx` (adjust the relative import depth: all four are one level below `src/app`):

```tsx
import type { JSX, ReactNode } from 'react';
import { AppShell } from '../shell/app-shell';

// Every page under this tab sits in the app shell (#381, lead decision 1).
export default function Layout({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <AppShell>{children}</AppShell>;
}
```

Check first whether any of the four folders already has a `layout.tsx` (`ls src/app/*/layout.tsx`); if one does, wrap its existing content in `<AppShell>` instead of replacing it.

- [ ] **Step 7: Home page in the shell**

In `src/app/page.tsx` wrap the returned `HomeView` in `<AppShell>…</AppShell>` (import from `./shell/app-shell`).

- [ ] **Step 8: Typecheck and run the web component tests**

Run: `pnpm --filter @mychess/web typecheck && pnpm --filter @mychess/web test:component`
Expected: PASS. A failure in `src/app/page.test.tsx` because `AppShell` calls the server is expected: mock `./shell/app-shell` in that test to render its children (`vi.mock('./shell/app-shell', () => ({ AppShell: ({ children }) => children }))`).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): the app shell on every tab, training left in focus mode (#381, R-218)"
```

---

### Task 10: Tab pages: drop the home links, one content width

**Files:**
- Modify: `src/app/home-view.tsx`, `src/app/page.test.tsx`, `src/app/repertoires/(list)/page.tsx`, `src/app/coach/page.tsx`, `src/app/fide/page.tsx`, `src/i18n/messages/en.json`

- [ ] **Step 1: Home**

In `home-view.tsx`: delete the link row `div` (Repertoires, Opponent's games, Coach dashboard, Settings, `SignOutButton`) and the `LINK` constant; drop the now-unused `accountId` and `isCoach` props (and their passing in `page.tsx`); keep the greeting `h1` but drop the `app.title` paragraph (the wordmark is in the top bar). Change `<main className=…>` to `<main className={`${CONTENT} gap-6`}>` (import `CONTENT` from `./surfaces`). Update `page.test.tsx`: remove assertions on the removed links; add one asserting the home page has no "Sign out" button (it moved to the account menu).

- [ ] **Step 2: Tab roots**

In each of `repertoires/(list)/page.tsx`, `coach/page.tsx`, `fide/page.tsx`: replace the local `Header` with `<PageHeader title={t('title')}>` (no `back`), keeping any intro paragraph as its child; delete the `Link href={ROUTES.home}` and unused imports; set `<main className={`${CONTENT} gap-8`}>` (fide keeps `gap-6`). The import page and other inner pages are Task 11.

- [ ] **Step 3: Unused catalogue keys**

`grep -rn "app\.\(repertoires\|fideSearch\|coachArea\|settings\|title\)\|'home'\|\.home'" apps/web/src apps/web/e2e` and remove from `en.json` each `app.*` key and each per-page `home` key (`repertoires.list.home`, `coach.home`, `settings.home`, and similar) that no file uses any more. Keep `app.signOut` (the sign-out button) and `app.greeting`.

- [ ] **Step 4: Tests and typecheck**

Run: `pnpm --filter @mychess/web typecheck && pnpm --filter @mychess/web test:component`
Expected: PASS (fix any test still looking for a removed home link by deleting that assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): tab pages lose their home links and share one content width (#381)"
```

---

### Task 11: Inner pages: `PageHeader`, explicit parents, full-height board pages

**Files:**
- Modify: `src/app/settings/page.tsx`, `src/app/repertoires/import/page.tsx`, `src/app/coach/players/[playerId]/page.tsx`, `src/app/coach/groups/[groupId]/page.tsx`, `src/app/repertoires/assigned/[id]/assigned-view.tsx`, `src/app/repertoires/not-found.tsx`, `src/app/repertoires/assigned/not-found.tsx`, `src/app/repertoire-view/repertoire-shell.tsx`, `src/app/repertoire-view/loading-shell.tsx`, and their tests

- [ ] **Step 1: List and form inner pages**

Give each a `PageHeader` with this parent, and `CONTENT` as its `main` width:

| Page | `back.href` | `back.parent` (catalogue) |
| --- | --- | --- |
| settings | `ROUTES.home` | `nav.today` |
| repertoires/import | `ROUTES.repertoires` | `nav.repertoires` |
| coach player | `ROUTES.coach` | `nav.coach` |
| coach group | `ROUTES.coach` | `nav.coach` |
| repertoires/not-found, assigned/not-found | `ROUTES.repertoires` | `nav.repertoires` |

Example (settings):

```tsx
function Header(): JSX.Element {
  const t = useTranslations();
  return (
    <PageHeader
      back={{ href: ROUTES.home, parent: t('nav.today') }}
      title={t('settings.title')}
    />
  );
}
```

Read each page before editing; replace only its header and `main` width. If a page's header has more than a back link and a title (actions, a subtitle), keep those as `PageHeader` children.

- [ ] **Step 2: Board pages' back targets**

In `repertoires/assigned/[id]/assigned-view.tsx` change `BackLink href={ROUTES.home}` to `href={ROUTES.repertoires}` with label `t('nav.back', { parent: t('nav.repertoires') })` (use a `useTranslations()` root translator). In `repertoires/[id]/repertoire-header.tsx` and `coach/.../shared-repertoire-view.tsx`, check the `BackLink` target and label and set them to Repertoires and the coach's player page respectively, with the same `nav.back` wording. Remove the per-page back keys that become unused (grep as in Task 10 Step 3).

- [ ] **Step 3: Full-height board pages leave room for the shell**

In `repertoire-view/repertoire-shell.tsx` (line ~92) and `repertoire-view/loading-shell.tsx` (line ~31) replace `h-dvh` with `h-[calc(100dvh-var(--shell-chrome,0px))]`, and in `repertoire-shell.tsx` replace `lg:top-8` with `lg:top-[calc(var(--shell-chrome,0px)+2rem)]` (the sticky board clears the sticky top bar). Replace `max-w-6xl` there with nothing: board pages use the full width (spec, "Content width"). Leave `training/frame-classes.ts` alone: training has no shell.

- [ ] **Step 4: Tests and typecheck**

Run: `pnpm --filter @mychess/web typecheck && pnpm --filter @mychess/web test:component`
Expected: PASS. Update any test that looked for an old back-link label to the new "Back to …" name.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): every inner page names its parent; board pages fit under the shell (#381)"
```

---

### Task 12: Cards

**Files:**
- Modify: every file matching `rounded-card border border-border bg-surface` or `bg-surface … shadow-card` with a `border-border` edge; `src/app/settings/styles.ts`

- [ ] **Step 1: Find them**

Run: `grep -rn "rounded-card" apps/web/src/app --include=*.ts --include=*.tsx | grep -v test | grep "bg-surface"`

- [ ] **Step 2: Replace**

For each surface card (a `bg-surface` box with `rounded-card` and a `border-border` edge) put `CARD` from `src/app/surfaces.ts` in place of `rounded-card border border-border bg-surface shadow-card` (keep the element's other classes). In `settings/styles.ts` change `SECTION_BASE`'s `sm:border` edge to `sm:border-card-edge` so `SECTION` reads `… border-t border-border pt-6 sm:rounded-card sm:border sm:border-card-edge sm:bg-surface sm:p-6 sm:shadow-card` (the phone rule stays `border-border`; `DANGER_SECTION` keeps `border-error`). Do not touch inner option boxes without `bg-surface` (they are list items, not cards).

- [ ] **Step 3: Tests**

Run: `pnpm --filter @mychess/web test:component` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): cards lifted by their shadow, a hairline only in dark (#381, R-219)"
```

---

### Task 13: E2E through the tabs, and the shell journey

**Files:**
- Create: `e2e/support/nav.ts`, `e2e/shell.spec.ts`
- Modify: `e2e/support/repertoires.ts`, `e2e/coaching.spec.ts`, `e2e/fide-search.spec.ts`, `e2e/settings.spec.ts`, `e2e/sign-in.spec.ts`

- [ ] **Step 1: Helpers**

```ts
// e2e/support/nav.ts
// The app shell as a person uses it (#381): the tabs and the account menu.
import type { Locator, Page } from '@playwright/test';
import type { Messages } from './journey';

type Tab = 'today' | 'repertoires' | 'opponents' | 'coach';

/** The main navigation (bottom bar on a phone, top bar on desktop). */
export const mainNav = (page: Page, messages: Messages): Locator =>
  page.getByRole('navigation', { name: messages.nav.label });

/** Opens a tab. Today's name may carry the due count, so it is a prefix. */
export async function openTab(
  page: Page,
  messages: Messages,
  tab: Tab,
): Promise<void> {
  await mainNav(page, messages)
    .getByRole('link', { name: messages.nav[tab] })
    .click();
}

/** Opens the account menu and follows one of its items. */
export async function fromAccountMenu(
  page: Page,
  messages: Messages,
  item: 'settings' | 'myCoaches' | 'signOut',
): Promise<void> {
  await page.getByRole('button', { name: messages.nav.account.open }).click();
  if (item === 'signOut')
    await page.getByRole('button', { name: messages.app.signOut }).click();
  else
    await page
      .getByRole('link', { name: messages.nav.account[item] })
      .click();
}
```

(`Messages` is exported by `e2e/support/journey.ts`.)

- [ ] **Step 2: Existing journeys**

- `support/repertoires.ts` `openRepertoires`: `await openTab(page, messages, 'repertoires');` instead of the `app.repertoires` link.
- `coaching.spec.ts:53`: `await openTab(page, en, 'coach');`
- `fide-search.spec.ts:62`: `await openTab(page, en, 'opponents');` and rename the test title's "from home" to "from the Opponents tab".
- `settings.spec.ts:20`: `await fromAccountMenu(page, en, 'settings');`
- `sign-in.spec.ts:87`: `await fromAccountMenu(page, en, 'signOut');`
- `grep -rn "en\.app\.\|messages\.app\." apps/web/e2e` for any other home-link use and switch it the same way.

- [ ] **Step 3: The shell journey**

```ts
// e2e/shell.spec.ts
import { expect } from '@playwright/test';
import { en, newOnboardedAccount, test } from './support/journey';
import { mainNav, openTab } from './support/nav';

test(
  'R-218: the tabs reach every area, an inner page leads back up, and a drill has no tabs',
  { tag: '@mobile' },
  async ({ page, request }) => {
    await newOnboardedAccount(page, request, 'Rokas Petrauskas');
    const nav = mainNav(page, en);
    await expect(nav).toBeVisible();
    await expect(
      nav.getByRole('link', { name: en.nav.today }),
    ).toHaveAttribute('aria-current', 'page');

    await openTab(page, en, 'repertoires');
    await expect(page).toHaveURL(/\/repertoires$/);
    await page
      .getByRole('link', { name: en.repertoires.list.import })
      .click();
    await expect(page).toHaveURL(/\/repertoires\/import$/);
    await expect(nav).toBeVisible();
    await page
      .getByRole('link', {
        name: en.nav.back.replace('{parent}', en.nav.repertoires),
      })
      .click();
    await expect(page).toHaveURL(/\/repertoires$/);

    await openTab(page, en, 'opponents');
    await expect(page).toHaveURL(/\/fide$/);
    await expect(nav.getByRole('link', { name: en.nav.coach })).toHaveCount(0);

    await page.goto('/training?mode=review');
    await expect(nav).toHaveCount(0);
  },
);
```

Use `format(en.nav.back, { parent: en.nav.repertoires })` from `./support/journey` instead of `.replace` (import `format` with `en`). If `/training?mode=review` with nothing due redirects or 404s, assert on whatever page it shows that the nav is absent; the assertion that matters is `toHaveCount(0)`.

- [ ] **Step 4: Run the E2E suite locally**

Start Postgres and Mailpit (`docs/operations.md`), then run: `pnpm --filter @mychess/web test:e2e`
Expected: all journeys pass on desktop and the @mobile ones on Pixel 7.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): journeys go through the tabs and the account menu; the shell journey (#381)"
```

---

### Task 14: Design docs, gate, sign-off

**Files:**
- Modify: `docs/design/README.md`

- [ ] **Step 1: Docs**

In `docs/design/README.md`:
- Add a `## Shell` section after `## Principles`: the tabs (R-218), phone vs desktop placement, the account menu, `PageHeader` and parents, focus mode, `CONTENT` (1040px) vs full-width board pages, `--shell-chrome`.
- In `## Tokens`: add `accent-subtle`, `card-edge`, `tabbar`, `container-content`; change the type row to "Inter (self-hosted, R-219), then the system stack"; radii values.
- Replace the light/dark numbers in the contrast table rows for `fg`, `fg-muted`, `accent`, `accent-fg`, `border-strong` with the values `tokens.test.ts` measures (print them once with a throwaway `console.log` in the test, then remove it), dated 2026-11-25, and add rows for `accent` on `accent-subtle`. Note under the table that `src/app/tokens.test.ts` now enforces the AA pairs.
- In `## Sign-off`: "LT and EN" becomes "EN" (R-217), so 4 screenshots per screen.

- [ ] **Step 2: Full gate**

Run: `node quality/gate.mjs check > gate.log 2>&1; grep -n "PASSED\|FAILED" gate.log`
Expected: `PASSED`. Fix any finding (CRAP, knip unused exports such as `ratio`, dependency-cruiser) at its source; never edit gate configuration.

- [ ] **Step 3: Commit and push**

```bash
git add docs/design/README.md
git commit -m "docs(design): the shell, Ocean tokens, Inter and the measured contrast (#381)"
git push origin main
```

- [ ] **Step 4: UX sign-off**

Dispatch the `ux-designer` agent: screenshots at 390px and 1280px, light and dark, of Today, Repertoires, a repertoire, import, Opponents, Coach, a coach player, Settings and Training on the persona stack (a production build, `next build` + `next start`, because of #382); a keyboard pass (skip link, tabs, account menu with Escape); a 200% zoom check; re-measure the board overlay pairs in the contrast table (`board-focus`, `board-hint-edge`, the marks) against the new dark-theme squares `#d7c2a0` / `#946f4f` and adjust any that dropped; compare against the spec's layouts. Fix what it reports, then re-run Step 2.

- [ ] **Step 5: Close out**

Run `mp-code-review` on the diff since `845c76a0`, then `improve-codebase-architecture` on `src/app/shell/`, `src/server/shell.ts` and `src/app/surfaces.ts`; present findings to the owner. Comment on #381 that part 1 (shell and visual refresh) is done and that part 2 (Today) is next; leave #381 open until all six parts are done.
