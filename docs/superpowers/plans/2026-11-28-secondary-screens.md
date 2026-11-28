# Secondary screens (#381 part 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the remaining screens to Ocean and fix the audit's findings: Settings as one page of soft cards with My coaches listing each coach's assignments (R-237), an account menu that is a bottom sheet on a phone, Opponents tidied, one entry frame for sign-in, welcome and the invite page, an invite link that names its coach before sign-in (R-235), a group invite that lists what it comes with (R-236), Accept landing on Today with a notice (R-234), app-wide 404, error and loading pages, and the part 5 invite-sheet leftover.

**Architecture:** One domain predicate (`isValidInvite`) decides whether an invite may be named to anyone; a new db read (`inviteTeaser`) uses it to give only the coach's display name and the group's name for the signed-out sign-in and welcome pages. `previewInvite` gains a group invite's current assignments. On the web side, a shared `EntryFrame` frames sign-in, welcome and the invite page, a shared `DeleteAccountControl` opens the existing delete form in the part 4 `Sheet`, a `LinkedNotice` moves the "linked with" line from Settings to Today, and the Settings page is recomposed from its existing forms in the new order and card style.

**Tech Stack:** TypeScript, Next.js App Router, next-intl, Tailwind tokens, Drizzle + Postgres (Testcontainers), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-28-secondary-screens-design.md`. Rulings R-234 to R-237.

**Commands** (from the repo root):
- domain tests: `pnpm --filter @mychess/domain exec vitest run <file>`
- db tests (Docker): `pnpm --filter @mychess/db exec vitest run <file>`
- web tests: `pnpm --filter @mychess/web exec vitest run <file>`
- typecheck: `pnpm -r typecheck`
- E2E (Docker and the local stack): `pnpm --filter @mychess/web exec playwright test <spec>`
- before each commit: format, lint, typecheck and the changed packages' tests (CLAUDE.md). Never edit gate configuration. No `any`, no `!`, no suppression comments; functions stay under complexity 10. Every user-visible string is a key in `apps/web/src/i18n/messages/en.json`.

**Conventions for every task:** components are `'use client'` only when they hold state or handlers. Tests are written first and assert what a user sees (role, name, text), not class names; the exception is where a layout rule is the behaviour, and then the test asserts the one class that carries it. A task's catalogue keys are added in the same commit as the code that uses them, and a key no longer used is removed (knip and the catalogue test catch leftovers). Commit messages end with `(#381)`.

**Pipeline per task** (`docs/agent-team.md`): developer (test first), then `qa`, then `architect` (`mp-code-review` on the task's diff), then `security-reviewer` for `- SECURITY` tasks, then `ux-designer` for `- UX` tasks, then the lead commits. One owner per shared file at a time (`en.json`, `routes.ts`, `packages/db/src/index.ts`): tasks touching them run one after another.

---

## File map

| File | Change |
| --- | --- |
| `packages/domain/src/invite.ts` (+ test), `index.ts` | `isValidInvite` exported (was the private `isValid`) |
| `packages/db/src/invites.ts` (+ test), `index.ts` | new `inviteTeaser`; `InvitePreview` active state gains `assignments` |
| `apps/web/src/lib/routes.ts` (+ test) | `acceptedInvitePath` to Today; `inviteTokenOf`; `settingsPath`, `settingsParent` |
| `apps/web/src/app/today/linked-notice.tsx` (+ test) | new: the one-time "linked with" line |
| `apps/web/src/server/today-page.ts` (+ test), `apps/web/src/app/page.tsx`, `today/today-view.tsx` (+ test) | `linked` fact and its notice |
| `apps/web/src/app/entry-frame.tsx` (+ test) | new: wordmark + centred soft card |
| `apps/web/src/app/delete-account-control.tsx` (+ test) | new: row or link opening the delete form in a `Sheet` |
| `apps/web/src/app/settings/delete-section.tsx` (+ test) | its form becomes `DeleteAccountForm`, no own section card |
| `apps/web/src/app/welcome/delete-disclosure.tsx` (+ test) | removed (replaced by `DeleteAccountControl`) |
| `apps/web/src/app/sign-in/page.tsx`, `sign-in-form.tsx` (+ tests) | frame, description line, invite teaser |
| `apps/web/src/app/welcome/page.tsx`, `onboarding-form.tsx` (+ tests) | frame, delete link, "Next: the invite from" |
| `apps/web/src/app/invite/[token]/page.tsx`, `invite-view.tsx`, `actions.ts` (+ tests) | frame, per-state headings, privacy list, Comes with, Accept to Today |
| `apps/web/src/app/settings/page.tsx`, `styles.ts`, `profile-form.tsx`, `training-form.tsx`, `coach-mode.tsx`, `providers.tsx`, `layout.tsx` (+ tests) | order, cards, secondary Saves with "Saved", widths, back link |
| `apps/web/src/app/settings/my-coaches.tsx` (+ test), `apps/web/src/server/settings-page.ts` (new, + test) | coach rows with assignments, error-tone actions, empty state |
| `apps/web/src/app/shell/account-menu.tsx`, `shell-context.tsx`, `app-shell.tsx`, `theme-switch.tsx` (+ tests) | phone sheet, email, dividers, My coaches, `from`, selected theme ring |
| `apps/web/src/app/fide/page.tsx`, `fide-search.tsx` (+ tests) | h1, field error placement, empty-state card |
| `apps/web/src/app/not-found.tsx`, `error.tsx`, `global-error.tsx` (+ tests) | new |
| `apps/web/src/app/settings/loading.tsx`, `fide/loading.tsx`, `invite/[token]/loading.tsx` | new |
| `apps/web/src/app/coach/invite-sheet.tsx` (+ test), `confirmed-action.tsx` (+ test) | made time with minutes; one open confirmation |
| `apps/web/src/i18n/messages/en.json` | keys added, changed, removed |
| `apps/web/e2e/invites.spec.ts` (or the current invite journey file), `settings.spec.ts`, `not-found.spec.ts` | journeys |
| `docs/design/README.md` | sign-off record |

---

### Task 1: The invite validity predicate (backend-dev)

**Files:**
- Modify: `packages/domain/src/invite.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/invite.test.ts`

The private `isValid(invite, coach, now)` already decides "active, coach not disabled, coach in Coach mode". R-235 needs the same answer outside `canAccept`, so it becomes the exported domain rule; `canAccept` keeps using it.

- [ ] **Step 1: Write the failing tests** in `invite.test.ts`, reusing the file's existing invite and coach builders:

```ts
describe('isValidInvite (R-235)', () => {
  const now = new Date('2026-11-28T12:00:00Z');
  it('is valid while active and its coach coaches', () => {
    expect(isValidInvite(activeInvite(now), coachingCoach(), now)).toBe(true);
  });
  it('is not valid once expired, used or revoked', () => {
    expect(isValidInvite(expiredInvite(now), coachingCoach(), now)).toBe(false);
    expect(isValidInvite(usedInvite(now), coachingCoach(), now)).toBe(false);
    expect(isValidInvite(revokedInvite(now), coachingCoach(), now)).toBe(false);
  });
  it('is not valid when its coach is disabled or out of Coach mode', () => {
    expect(isValidInvite(activeInvite(now), disabledCoach(), now)).toBe(false);
    expect(isValidInvite(activeInvite(now), notCoachingCoach(), now)).toBe(false);
  });
});
```

Use the builder names the file already has; add any missing one beside the others.

- [ ] **Step 2: Run** `pnpm --filter @mychess/domain exec vitest run src/invite.test.ts`. Expected: FAIL, `isValidInvite` is not exported.
- [ ] **Step 3: Implement.** Rename `isValid` to `isValidInvite`, export it with the doc comment "An invite is valid while active and while its coach is neither disabled (R-108) nor out of Coach mode. Only a valid invite may be named to anyone (R-235).", and use it in `canAccept`. Export it from `index.ts` (the entry point exports only what other packages import: `@mychess/db` imports it in Task 2).
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(domain): isValidInvite, the rule that lets an invite be named (#381)`

---

### Task 2: The signed-out invite teaser (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/invites.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/invites.test.ts`

- [ ] **Step 1: Write the failing db tests** (Testcontainers, the file's existing helpers for coaches, groups and invites):

```ts
describe('inviteTeaser (R-235)', () => {
  it('names the coach of a valid personal invite, with no group', async () => {
    const { token, coach } = await personalInvite();
    expect(await inviteTeaser(db, token, now)).toEqual({
      coachDisplayName: coach.displayName,
      groupName: null,
    });
  });
  it('names the coach and the group of a valid group invite', async () => {
    const { token, coach, group } = await groupInvite();
    expect(await inviteTeaser(db, token, now)).toEqual({
      coachDisplayName: coach.displayName,
      groupName: group.name,
    });
  });
  it.each(['expired', 'used', 'revoked'] as const)(
    'names no one for a %s invite',
    async (state) => {
      const { token } = await personalInviteIn(state);
      expect(await inviteTeaser(db, token, now)).toBeUndefined();
    },
  );
  it('names no one when the coach left Coach mode or is disabled', async () => {
    const { token, coach } = await personalInvite();
    await stopCoachingFor(coach.id);
    expect(await inviteTeaser(db, token, now)).toBeUndefined();
  });
  it('names no one for an unknown or malformed token', async () => {
    expect(await inviteTeaser(db, 'A'.repeat(43), now)).toBeUndefined();
    expect(await inviteTeaser(db, 'not-a-token', now)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @mychess/db exec vitest run src/invites.test.ts -t inviteTeaser`. Expected: FAIL, not exported.
- [ ] **Step 3: Implement** in `invites.ts`, beside `previewInvite`:

```ts
/** What an invite link may say to anyone holding it (R-235). */
export interface InviteTeaser {
  readonly coachDisplayName: string;
  readonly groupName: string | null;
}

/**
 * The coach's display name and the group's name of a valid invite
 * (isValidInvite), for a visitor who is not signed in (R-235); undefined
 * for anything else, so an invalid link names no one. Reads nothing about
 * the coach's players. `token` is the raw token; a malformed one is
 * refused without a lookup, and the token is never logged. SECURITY.
 */
export async function inviteTeaser(
  db: Executor,
  token: string,
  now: Date,
): Promise<InviteTeaser | undefined> {
  const tokenHash = parsedTokenHash(token);
  if (tokenHash === undefined) return undefined;
  const invite = await findPreviewedInvite(db, tokenHash);
  if (invite === undefined) return undefined;
  const coach = await findAccountById(db, invite.coachId);
  if (coach === undefined || !isValidInvite(invite, coach, now))
    return undefined;
  return { coachDisplayName: coach.displayName, groupName: invite.groupName };
}
```

If `findAccountById`'s result does not satisfy `InvitingCoach`, map it the way `decide` does; do not widen the domain type. Export `inviteTeaser` and `InviteTeaser` from `index.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(db): inviteTeaser names a valid invite's coach and group (#381)`

---

### Task 3: A group invite lists what it comes with (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/invites.ts`
- Test: `packages/db/src/invites.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
describe('previewInvite assignments (R-236)', () => {
  it("lists a valid group invite's assignments by name with deadlines", async () => {
    const { token, coach, group } = await groupInvite();
    await assignToGroup(coach.id, group.id, 'Caro-Kann basics', '2026-12-20');
    await assignToGroup(coach.id, group.id, 'Alapin', null);
    const preview = await previewInvite(db, token, player.id, now);
    expect(preview).toMatchObject({
      ok: true,
      value: {
        state: 'active',
        assignments: [
          { repertoireName: 'Alapin', deadline: null },
          { repertoireName: 'Caro-Kann basics', deadline: '2026-12-20' },
        ],
      },
    });
  });
  it('lists none for a personal invite', async () => {
    const { token } = await personalInvite();
    const preview = await previewInvite(db, token, player.id, now);
    expect(preview).toMatchObject({ ok: true, value: { assignments: [] } });
  });
  it('lists nothing for an invalid invite (the refusal only)', async () => {
    const { token } = await groupInviteIn('revoked');
    const preview = await previewInvite(db, token, player.id, now);
    expect(preview.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run** them. Expected: FAIL, no `assignments`.
- [ ] **Step 3: Implement.** Add `readonly assignments: readonly GroupAssignment[]` to the `active` member of `InvitePreview`. In `previewInvite`, after `decide` succeeds:

```ts
const assignments =
  invite.groupId === null
    ? []
    : await assignmentsToGroup(db, invite.coachId, invite.groupId);
return ok({ state: 'active', ...shown, kind: invite.kind, assignments });
```

Import `assignmentsToGroup` and `GroupAssignment` from `./groups`. The `accepted` state stays as it is.
- [ ] **Step 4: Run** the tests and `pnpm -r typecheck`. Expected: PASS (the web `InviteView` test fixtures may need `assignments: []`; add it).
- [ ] **Step 5: Commit:** `feat(db): a group invite's preview lists its assignments (#381)`

---

### Task 4: Routes (web-dev)

**Files:**
- Modify: `apps/web/src/lib/routes.ts`
- Test: `apps/web/src/lib/routes.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
describe('acceptedInvitePath (R-234)', () => {
  it('lands on Today with the coach, and the group when there is one', () => {
    expect(acceptedInvitePath('c1', null)).toBe('/?linked=c1');
    expect(acceptedInvitePath('c1', 'g1')).toBe('/?linked=c1&group=g1');
  });
});
describe('inviteTokenOf', () => {
  it('gives the token of an invite return path, else null', () => {
    const token = `${'A'.repeat(42)}_`;
    expect(inviteTokenOf(`/invite/${token}`)).toBe(token);
    expect(inviteTokenOf('/settings')).toBeNull();
    expect(inviteTokenOf(null)).toBeNull();
  });
});
describe('settings from a tab', () => {
  it('carries a known tab and goes back to it', () => {
    expect(settingsPath('coach')).toBe('/settings?from=coach');
    expect(settingsParent('coach')).toBe('/coach');
    expect(settingsParent('opponents')).toBe('/fide');
  });
  it('goes back to Today for anything else', () => {
    expect(settingsParent(undefined)).toBe('/');
    expect(settingsParent('https://evil.example')).toBe('/');
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @mychess/web exec vitest run src/lib/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `routes.ts`:

```ts
/** Today after accepting an invite, with whom (R-234). */
export const acceptedInvitePath = (
  coachId: string,
  groupId: string | null,
): string => {
  const query = new URLSearchParams({ linked: coachId });
  if (groupId !== null) query.set('group', groupId);
  return `${ROUTES.home}?${query.toString()}`;
};

/** The invite token of a return path to an invite, or null. */
export const inviteTokenOf = (path: string | null): string | null => {
  const match = /^\/invite\/([^/?#]+)$/u.exec(path ?? '');
  return match?.[1] ?? null;
};

/** The tabs Settings can be opened from, and where each goes back to. */
const SETTINGS_FROM = {
  today: ROUTES.home,
  repertoires: ROUTES.repertoires,
  opponents: ROUTES.fide,
  coach: ROUTES.coach,
} as const;
export type SettingsFrom = keyof typeof SETTINGS_FROM;

const isSettingsFrom = (raw: unknown): raw is SettingsFrom =>
  typeof raw === 'string' && Object.hasOwn(SETTINGS_FROM, raw);

export const settingsPath = (from: SettingsFrom): string =>
  `${ROUTES.settings}?from=${from}`;

/** Settings' parent: the tab it was opened from, else Today. */
export const settingsParent = (raw: unknown): string =>
  isSettingsFrom(raw) ? SETTINGS_FROM[raw] : ROUTES.home;
```

Use the `ROUTES` keys that exist for the four tabs (check the names; the tab bar uses them). `inviteTokenOf` returns the raw segment; the caller parses it with `inviteTokenSchema`. Update the one caller of `acceptedInvitePath` (`invite/[token]/actions.ts`) to pass `accepted.value.groupId` and fix its doc comment ("the player lands on Today with the linked notice, R-234"). `ROUTES.myCoaches` stays.
- [ ] **Step 4: Run** the tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): routes for the linked notice, the invite token and Settings' parent (#381)`

---

### Task 5: Today's linked notice (web-dev) - UX

**Files:**
- Create: `apps/web/src/app/today/linked-notice.tsx`, `linked-notice.test.tsx`
- Modify: `apps/web/src/server/today-page.ts` (+ test), `apps/web/src/app/page.tsx`, `apps/web/src/app/today/today-view.tsx` (+ test), `apps/web/src/app/settings/my-coaches.tsx` (+ test), `apps/web/src/app/settings/page.tsx`

- [ ] **Step 1: Failing tests.**
  - `today-page.test.ts`: `todayPage(account, { linked: 'c1', group: 'g1' })` gives `linked: { coachName: 'Rimantas V.', groupName: 'Juniors 2026' }` when the player is linked with `c1` and a member of that coach's group `g1`; `groupName: null` when linked but not in `g1`; `linked: null` when not linked with `c1`, or when no `linked` param. The coach's name comes from `playerCoaches`, never from the URL.
  - `linked-notice.test.tsx`: renders "You are linked with Rimantas V." (and "You are linked with Rimantas V. through Juniors 2026." with a group) as a success status; after render, `window.location` has no `linked` or `group` param (History API replace, as `useDropAcceptedParam` does now); a Dismiss button removes it.
  - `today-view.test.tsx`: the notice is the first thing in the main column when `linked` is set, absent when null.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move `useDropAcceptedParam` out of `my-coaches.tsx` into `linked-notice.tsx` as `useDropParams(['linked', 'group'], active)`, keeping its comment about the History API. `LinkedNotice({ linked })` renders `StatusLine` tone success plus a quiet Dismiss button (local state).
  - `todayPage(account, params)` reads `playerCoaches(getDb(), account.id)` only when `params.linked` is a string, and finds the coach by id and the group among that coach's `groups`.
  - `page.tsx` passes the `linked` and `group` search params.
  - Remove `acceptedCoachId`, the `accepted` status line and the `?coach=` param from `MyCoaches` and `settings/page.tsx`; delete their tests and catalogue keys; move the text to `today.linked` / `today.linkedThrough` keys.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): accepting an invite lands on Today with a linked notice (R-234, #381)`

---

### Task 6: The entry frame (web-dev) - UX

**Files:**
- Create: `apps/web/src/app/entry-frame.tsx`, `entry-frame.test.tsx`

- [ ] **Step 1: Failing test:** `EntryFrame` renders the wordmark as a link to Today named "MyChess", a `main` landmark holding a single card with its children, and an optional `below` slot rendered after the card (for welcome's delete link).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Take the outer layout that `sign-in-form.tsx` uses today (centred card, its widths) and lift it into `EntryFrame({ children, below })`: wordmark in `text-fg` (as the top bar), card `rounded-card bg-surface p-8 shadow-card` with `border-card-edge`, vertically centred from `md` (`md:min-h-dvh md:justify-center`), top-aligned with `pt-6` on a phone. The card has a fixed position in the column, so content opening inside it never re-centres the page (finding 23): centre with a fixed top offset (`md:pt-[18vh]`), not `justify-center`, if `justify-center` makes it jump; the test for welcome in Task 8 checks that the heading's position does not change.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): one entry frame for sign-in, welcome and invite (#381)`

---

### Task 7: Delete account behind a sheet (web-dev) - UX

**Files:**
- Create: `apps/web/src/app/delete-account-control.tsx`, `delete-account-control.test.tsx`
- Modify: `apps/web/src/app/settings/delete-section.tsx` (+ test)
- Delete: `apps/web/src/app/welcome/delete-disclosure.tsx`

- [ ] **Step 1: Failing tests.**
  - `DeleteAccountControl({ account, canExport, variant: 'row' | 'link' })`: shows a button "Delete account…" (row: error-tone full row; link: quiet text link); pressing it opens a dialog named "Delete account" holding today's form (the email confirmation field, the export reminder or `ExportNotFresh`, the red Delete button); Cancel or Escape closes it and returns focus to the button.
  - The existing `delete-section.test.tsx` cases for the form (wrong email refused, success signs out) move to the form component and keep passing.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Split `DeleteSection` into `DeleteAccountForm` (the form and its state, no section card or heading) and drop `DANGER_SECTION`. `DeleteAccountControl` holds `open` state and renders the part 4 `Sheet` (bottom sheet on a phone, dialog from md) with an `h2` "Delete account" and `DeleteAccountForm`. Remove `delete-disclosure.tsx` and its catalogue keys once welcome uses the control (Task 8 does; keep the file until then if Task 8 runs later, but delete it in whichever task removes its last user).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): delete account opens in a sheet (#381)`

---

### Task 8: Sign-in and welcome in the frame (web-dev) - UX, SECURITY

**Files:**
- Modify: `apps/web/src/app/sign-in/page.tsx`, `sign-in-form.tsx`, `apps/web/src/app/welcome/page.tsx`, `onboarding-form.tsx` (+ tests)

- [ ] **Step 1: Failing tests.**
  - Sign-in page: with `?next=/invite/<valid token>` and `inviteTeaser` returning `{ coachDisplayName: 'Rimantas V.', groupName: 'Juniors 2026' }`, the form says "Rimantas V. invited you to Juniors 2026. Sign in to accept."; with `groupName: null`, "Rimantas V. invited you to train with them. Sign in to accept."; with `inviteTeaser` returning undefined, today's generic invite line and no name; a malformed token never calls `inviteTeaser`. Without `next`, the description line ("Practise your openings…", final copy from the lead) shows under the wordmark.
  - Welcome page: with an invite `next` and a teaser, "Next: the invite from Rimantas V." under the form; without, nothing. The "Delete account…" link opens the sheet (Task 7), and the heading's `getBoundingClientRect().top` is the same before and after opening it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In both pages: `const token = inviteTokenSchema.safeParse(inviteTokenOf(next))`; when it parses, `teaser = await inviteTeaser(getDb(), token.data, new Date())`; pass `teaser ?? null` down. Wrap both in `EntryFrame`; welcome passes `<DeleteAccountControl variant="link" … />` as `below`. Never log the token or put it in an error.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): sign-in and welcome name the inviting coach (R-235, #381)`

---

### Task 9: The invite page (web-dev) - UX, SECURITY

**Files:**
- Modify: `apps/web/src/app/invite/[token]/invite-view.tsx`, `page.tsx` (+ test)

- [ ] **Step 1: Failing tests** in `invite-view.test.tsx`:
  - Active personal: h1 "Rimantas V. invites you"; a list of three items (what the coach will see, what stays private, unlink any time from Settings); Accept (primary) and "Not now" (link to Today); no "Comes with".
  - Active group: h1 "Rimantas V. invites you to Juniors 2026"; "Comes with" and one item per assignment, "Caro-Kann basics · deadline 20 Dec" (the part 5 `AssignmentStatus` "deadline" wording) and "Alapin · No deadline"; no "Comes with" when `assignments` is empty.
  - Accepted: h1 "You are linked with Rimantas V.", a primary "Go to Today".
  - Not valid: h1 "This invite link is not valid", an error-tone status "Ask your coach for a new link.", a secondary "Go to Today".
  - Own invite: h1 "This is your own invite", an info status, a secondary "Back to Coach" to `/coach`.
  - Coach full keeps today's refusal text, as an error-tone status.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the view inside `EntryFrame`, one small component per state so each stays under complexity 10. Replace the privacy paragraph keys with three list keys.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): the invite page per state, with what a group comes with (R-236, #381)`

---

### Task 10: Settings as one page of cards (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`, `styles.ts`, `profile-form.tsx`, `training-form.tsx`, `coach-mode.tsx`, `providers.tsx`, `layout.tsx` (+ tests)

- [ ] **Step 1: Failing tests.**
  - `page.test.tsx`: the section headings in order are Training, My coaches, Account, Coach mode, Your data; Account holds the display name form and the sign-in methods; Your data holds Download my data and the "Delete account…" row; the PageHeader's back link goes to `/coach` with `?from=coach`, to `/` with none.
  - `profile-form.test.tsx`, `training-form.test.tsx`: Save is a secondary button; after a successful save a status "Saved" shows beside it.
  - `coach-mode.test.tsx`: one line saying what Coach mode does, and a secondary switch button.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `styles.ts`: every section is a soft card at every width (`rounded-card border border-card-edge bg-surface p-6 shadow-card`, `p-4` under `sm`); drop the rule-on-phone variant and `DANGER_SECTION`; update the file's comment.
  - The page column is 640px on desktop (`max-w-[40rem]`, check the existing content-width token from part 1 and use it if one fits). Text fields up to 360px (`max-w-[22.5rem]`), number fields keep 128px.
  - Every Save uses `SECONDARY_BUTTON` with `self-start`; no `PRIMARY_BUTTON` on the page.
  - Merge Profile and Providers under one Account card heading (two sub-blocks).
  - `page.tsx` reads `from` and passes `settingsParent(from)` to the PageHeader's parent.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): settings as one page of soft cards, most used first (#381)`

---

### Task 11: My coaches lists each coach's assignments (web-dev) - UX

**Files:**
- Create: `apps/web/src/server/settings-page.ts`, `settings-page.test.ts`
- Modify: `apps/web/src/app/settings/my-coaches.tsx` (+ test), `page.tsx`

- [ ] **Step 1: Failing tests.**
  - `settings-page.test.ts`: `coachRows(coaches, assignments)` gives one row per coach with that coach's `PlayerAssignment`s (matched on `coachId`), by repertoire name, and the coach's groups; a coach with none gives an empty list.
  - `my-coaches.test.tsx`: per coach, its name, each assignment's name with its status line (`AssignmentStatusLine` with "deadline" wording, the Paused, Overdue and Done pills), the groups each with "Leave group"; Unlink and Leave group are buttons with the error tone (assert their accessible names; the error-tone class is the behaviour, so assert `text-error` once); empty: "No coach yet. A coach links with you by sending an invite link."
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `settings/page.tsx` also reads `playerAssignments(getDb(), account.id, new Date())` and passes `coachRows(...)` to `MyCoaches`. Rows are soft rows inside the card, separated by a hairline; actions right-aligned from `sm`, full-width rows on a phone. The section keeps `id="coaches"` and gets `scroll-mt-[calc(var(--top-bar-height)+1rem)]` (use the top bar's height token from part 1; add none if one exists under another name). If `AssignmentStatusLine` takes a `CoachStatus` from `@mychess/db`, build that shape from the `PlayerAssignment` in `coachRows` (deadline, overdue from `badges`, paused, done); do not import coach-only code paths that read other players.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): my coaches lists what each coach gives you (R-237, #381)`

---

### Task 12: The account menu (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/shell/account-menu.tsx`, `shell-context.tsx`, `app-shell.tsx`, `theme-switch.tsx` (+ tests)

- [ ] **Step 1: Failing tests.**
  - The menu shows the display name and the email (muted), then Settings, My coaches, Theme, then Sign out as a plain row (a `button` without the outlined class), with separators (`role="separator"`) before Settings and before Sign out.
  - Settings and My coaches links carry `?from=` of the current tab (from `usePathname()`: `/coach…` → coach, `/repertoires…` → repertoires, `/fide…` → opponents, else today).
  - With `matchMedia('(min-width: 48rem)')` false the avatar opens a dialog (the `Sheet`); true, the dropdown as today.
  - The selected theme option has the `ring-accent` class (the behaviour is the ring).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add `email` to `ShellAccount` and fill it in `app-shell.tsx` from the session account. The md breakpoint value must match the Tailwind `md` breakpoint (check `globals.css`); read `matchMedia` when the avatar is pressed, not during render. Extract `MenuItems` used by both the dropdown and the sheet. Theme switch: selected option `bg-accent-subtle ring-2 ring-accent` in both themes.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): the account menu as a sheet on a phone, with your email (#381)`

---

### Task 13: Opponents (web-dev, then ux-designer) - UX

**Files:**
- Modify: `apps/web/src/app/fide/page.tsx`, `fide-search.tsx` (+ tests)

- [ ] **Step 1: Failing tests.** The h1 is "Opponents". An invalid FIDE id shows its error directly after the field, before the hint (assert DOM order and `aria-describedby` linking the field to the error). Before any search, a card explains what a search shows.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Rename the heading key; move the error element; add the empty-state card (muted text in a soft card).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5 (ux-designer):** start the local stack with `FIDE_DUMP_FIXTURE_DIR` set (ask the lead to start it if the permission check blocks the restart), search a fixture player, screenshot results at the four sizes and both themes, and list any Ocean mismatch in the results; the web-dev fixes them in this task.
- [ ] **Step 6: Commit:** `feat(web): Opponents heading, field error and empty state (#381)`

---

### Task 14: 404, error and loading pages (web-dev) - UX

**Files:**
- Create: `apps/web/src/app/not-found.tsx`, `error.tsx`, `global-error.tsx` (+ tests); `apps/web/src/app/settings/loading.tsx`, `apps/web/src/app/fide/loading.tsx`, `apps/web/src/app/invite/[token]/loading.tsx`

- [ ] **Step 1: Failing tests.** `not-found`: "Page not found", one line, a "Go to Today" link; inside `AppShell` when signed in, inside `EntryFrame` otherwise. `error`: "Something went wrong", a "Try again" button calling `reset`, a "Go to Today" link, no error message text. `global-error`: the same with its own `<html><body>` and the theme tokens.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Loading files render card skeletons (`animate-pulse bg-sunken rounded-card`) in each page's column, with `aria-busy` and a visually hidden "Loading". Follow `coach/not-found.tsx` for the shell pattern.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(web): app 404, error and loading pages (#381)`

---

### Task 15: Invite a player sheet leftover (web-dev) - UX

**Files:**
- Modify: `apps/web/src/app/coach/invite-sheet.tsx` (+ test), `apps/web/src/app/confirmed-action.tsx` (+ test) or the sheet's own revoke list

- [ ] **Step 1: Failing tests.** Two open invites made the same day read "made 28 Nov, 14:05 · expires 5 Dec" and "made 28 Nov, 16:40 · expires 5 Dec" (Europe/Vilnius); opening a second Revoke confirmation closes the first.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Format `createdAt` with date and minute in the user's time zone (the catalogue's date formats). Hold the open revoke id in the sheet's state and pass `open`/`onOpenChange` to each confirmation; if `ConfirmedAction` has no controlled mode, add an optional one without changing its other users.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `fix(web): open invites tell apart by time; one revoke at a time (#381)`

---

### Task 16: E2E journeys (qa)

**Files:**
- Modify or create under `apps/web/e2e/`: the invite journey spec, `settings.spec.ts`, `not-found.spec.ts`

- [ ] **Step 1:** Signed-out invite journey (@mobile): the coach persona makes a group invite whose group has an assignment; a fresh browser opens the link; sign-in names the coach and the group; the player signs in through Mailpit (8026), onboards (welcome says "Next: the invite from …"), sees "Comes with" and the repertoire, accepts, lands on Today with "You are linked with … through …" and the assignment on Today's list; a reload drops the notice.
- [ ] **Step 2:** Settings (@mobile): the card order; Delete account opens a sheet on Pixel 7 and Cancel closes it; My coaches lists the assignment.
- [ ] **Step 3:** `/no-such-page` shows "Page not found" with "Go to Today".
- [ ] **Step 4:** Run the changed specs on desktop and Pixel 7. Expected: PASS. Clean up any account the journeys create (fixtures, not production data).
- [ ] **Step 5: Commit:** `test(e2e): invite, settings and 404 journeys (#381)`

---

### Task 17: Sign-off (ux-designer, security-reviewer, lead)

- [ ] **Step 1 (security-reviewer):** review Tasks 2, 3, 8 and 9: the teaser reads only the two names of a valid invite, never logs the token, and the group assignments show only to a signed-in viewer of a valid group invite.
- [ ] **Step 2 (ux-designer):** sign off every screen in the spec at 390x844, 375x667, 1280x800 and 1440x900 in light and dark, against each audit finding; record it in `docs/design/README.md`.
- [ ] **Step 3 (lead):** the full gate (`node quality/gate.mjs check`), push, CI green (gate, E2E desktop and Pixel 7, deploy); then `mp-code-review` on the slice diff, `improve-codebase-architecture` on its files, retro; comment on #381 and close it (part 6 is the last sub-project).
