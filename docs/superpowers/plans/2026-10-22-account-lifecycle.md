# Account Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gather the Account's lifecycle into one pure domain module, `packages/domain/src/account-lifecycle.ts`: the stage (`notOnboarded`, `onboarded`, `disabled`) and the transitions as decisions that return values (`decideOnboarding`, `decideDisable`, `deleteConfirmation`, `canDelete`, `decideDeletion`). db applies a decided change on the locked row; web gates on the stage and maps answers to redirects. Behaviour, refusal reasons, catalogue keys, mails, redirects and every existing feature test stay unchanged, except the race outcomes the spec lists (decision 7).

**Architecture:**
- **Domain** (`packages/domain/src/account-lifecycle.ts`, new): moved `isOnboarded`, `isDisabled`, `DeletableAccount`, `deletableAccount`, `canDelete`; new `accountStage`, `LIFECYCLE_REFUSALS`, `decideOnboarding`, `decideDisable`, `deleteConfirmation`, `decideDeletion`. `canDisable` goes.
- **Database** (`packages/db`): `completeOnboarding` decides under the account lock and returns a `Result`; `audited` locks its target (`lockAccountByEmail`); `disableAccount` applies `decideDisable`; new `deleteConfirmedAccount` decides under the lock and shares the delete body with the unchanged `deleteAccount`.
- **Web** (`apps/web`): `session.ts`, the onboarding page and action, and the invite page gate on `accountStage`; new `lib/onboarding-redirect.ts`; `deleteAccountAction` calls `deleteConfirmedAccount`; `delete-section.tsx` asks `deleteConfirmation`.
- **Migration:** none. **Catalogue:** no change.

**Tech Stack:** Drizzle on Postgres (Testcontainers for db and `web-feature` tests), Next.js App Router server actions, zod 4, vitest 4, fast-check.

**Spec:** `docs/superpowers/specs/2026-10-22-account-lifecycle-design.md` (the lead commits it from the scratchpad). **Issue:** #267 (S1 architecture review #251, candidate 2). **Rulings kept:** R-40, R-49, R-72, R-80, R-81, R-82, R-86, R-87, R-88, R-94, R-108, R-137. **Follows:** #265 (`sign-in.ts`, `canOpenSession`), #276 (`editRepertoire`: lock, decide, save).

**Roles:** each task names its role. Tasks marked `- SECURITY` go through `security-reviewer` (account disable, deletion, the session gate). No task is UX or i18n: no visible change, no catalogue change. Per task, the order is:
1. the developer, test first;
2. `qa`, which checks that every test the spec lists under "Tests that must pass unchanged" still passes byte for byte, and that only the blocks under "Tests that change shape" changed;
3. `architect` (`mp-code-review` on the task's diff);
4. `security-reviewer` for SECURITY tasks;
5. the lead commits at the checkpoints below.

**Rules for every task** (CLAUDE.md):
- Test first.
- No suppression comments, no `any`, no `!`.
- Complexity <= 10, CRAP <= 30.
- Refusals are `Result` values; exceptions only for programmer errors.
- A teammate runs only their own package's tests: backend-dev runs `pnpm --filter @mychess/domain test` and `pnpm --filter @mychess/db test`; web-dev runs `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`.
- The lead runs `node quality/gate.mjs check` once before each commit, without a pipe, and commits only on exit 0.
- Nobody runs mutation testing locally (#273).
- **Behaviour-preserving:** a test that is not listed under the spec's "Tests that change shape" must not be edited. If one fails, the code is wrong, not the test: the developer stops and reports.
- New test files sit where a vitest project runs them: domain `src/**/*.test.ts`, db `test/**/*.test.ts`, web component `src/**/*.test.{ts,tsx}`, web feature `test/feature/**/*.test.ts`.

**Commits:** the lead commits at three checkpoints:
- after A3: `refactor(domain): one Account lifecycle module - stage, onboarding, disable, deletion as decisions (#267)`;
- after B3: `refactor(db): onboarding, disable and deletion decided on the locked account row (#267)`;
- after C2: `refactor(web): lifecycle gates and deletion through the domain; no stage read from columns in web (#267)`.

Part A adds to the domain and moves code inside it; the index keeps exporting every name web and db import today, so nothing outside changes until B. If knip flags a new export as unused at the A3 checkpoint, the lead holds the commit until B3 instead of suppressing.

---

## Verified code this plan builds on

Read while planning (2026-10-22, `main` at 7c7ea91). A worker who finds a difference stops and tells the lead.

- **Domain:** `account.ts:79-140` (`isOnboarded`, `isDisabled`, `hasProvenEmail`, `DeletableAccount`, `deletableAccount`, `sameEmail`, `sameName`, `canDelete`); `admin.ts:1-26` (`ADMIN_REFUSALS`, `canDisable`); `sign-in.ts:2-8`, `:120-124`, `:190` (`isDisabled`, `canOpenSession`); `invite.ts:97`, `:110-114` (`InvitingCoach`, `isValid`); `index.ts:1-31`. `@mychess/chess` `result.ts` (`ok`, `refuse`, `Result`).
- **db:** `accounts.ts:13-24` (`accountColumns`), `:43-52` (`lockAccountById`, `FOR NO KEY UPDATE`), `:62-94` (`setProfile`, `updateProfile`, `completeOnboarding`); `admin.ts:31-108` (`AdminChange`, `audited` reading with `findAccountByEmail`, `disableAccount`); `account-delete.ts:1-68` (`deleteAccount`, `retryOnConflict(..., DELETE_ATTEMPTS)`, lock, `forkForDeletingCoach`, token delete, account delete); `retry-on-conflict.ts` (`retryOnConflict<T>` returns `fn`'s value); `client.ts:9-12` (`Tx`, `Executor`); `bin/admin-command.ts`, `bin/admin-disable.ts` (unchanged).
- **web:** `server/session.ts:26-45`; `app/pradzia/page.tsx:24-26`; `app/pradzia/actions.ts:27-38`; `app/k/[token]/page.tsx:32-35`; `app/nustatymai/actions.ts:62-84`; `app/nustatymai/delete-section.tsx:82-97`, `:117-119`; `server/auth.ts:221-224` (`mayOpenSession`, not changed).
- **Test constraints found while planning:**
  - `app/pradzia/page.test.tsx:41-54` mocks `../../server/session` with `requireAccount` and `hasFreshSession` only, so the onboarding page must keep calling `requireAccount` and gate itself (spec decision 9). Six more unit tests mock the session module by name; its export names stay.
  - `apps/web/test/feature/support/auth.ts:117`, `packages/db/test/accounts.test.ts:118`, `:288` await `completeOnboarding` on a fresh account and ignore the answer (spec decision 11).
  - Twelve db and feature tests call `deleteAccount(db, id, now?)` directly (spec decision 10).

---

## Decisions taken while planning

None of these is a product rule.

1. **Order of work.** A moves and adds in the domain but keeps `canDisable` until B2, so db compiles at every checkpoint. B2 deletes `canDisable` from `admin.ts`, its test block and the index.
2. **Types.**

```ts
export type AccountStage = 'notOnboarded' | 'onboarded' | 'disabled';

export const LIFECYCLE_REFUSALS = {
  alreadyOnboarded: 'lifecycle.alreadyOnboarded',
  accountClosed: 'lifecycle.accountClosed',
} as const;

export type LifecycleRefusalReason =
  (typeof LIFECYCLE_REFUSALS)[keyof typeof LIFECYCLE_REFUSALS];

export interface OnboardingRefusal {
  readonly reason: LifecycleRefusalReason;
}

export interface Onboarding {
  readonly profile: Profile;
  readonly onboardedAt: Date;
}

export type DeleteConfirmation = 'displayName' | 'email';

export interface AccountDeletion {
  /** Where the R-82 confirmation goes; null for an unproven email (R-87) or an account already gone. */
  readonly confirmationMail: { readonly to: string; readonly locale: Locale } | null;
}
```

3. **Signatures.**
   - `accountStage(account: Pick<Account, 'onboardedAt' | 'disabledAt'>): AccountStage`
   - `decideOnboarding(account: Account | undefined, profile: Profile, now: Date): Result<Onboarding, OnboardingRefusal>`
   - `decideDisable(account: Account, now: Date): Result<{ disabledAt: Date }, AdminRefusal>`
   - `deleteConfirmation(account: Pick<Account, 'onboardedAt'>): DeleteConfirmation`
   - `canDelete(account: DeletableAccount, typed: string): Result<undefined, AccountRefusal>` (unchanged)
   - `decideDeletion(account: Account | undefined, typed: string): Result<AccountDeletion, AccountRefusal>`
   - db: `completeOnboarding(db: Executor, id: string, profile: Profile, now: Date): Promise<Result<undefined, OnboardingRefusal>>`; `lockAccountByEmail(tx: Tx, email: string): Promise<Account | undefined>`; `deleteConfirmedAccount(db: Db, request: { id: string; typed: string; now: Date }): Promise<Result<AccountDeletion, AccountRefusal>>`.
   - web: `onboardingRefusalPath(refusal: OnboardingRefusal, next: string | null): string`.
4. **`decideOnboarding` order:** `undefined` or `disabled` first (`accountClosed`), then `onboarded` (`alreadyOnboarded`), then `ok`. A disabled account that was also onboarded is `accountClosed` (no way in wins).
5. **`completeOnboarding` inside a caller's transaction:** it calls `db.transaction`, which on a `Tx` is a savepoint, as `editRepertoire` does on an `Executor`.

---

## File structure

**packages/domain** (backend-dev):
- `src/account-lifecycle.ts`, `src/account-lifecycle.test.ts` (new, A1, A2).
- `src/account.ts`, `src/account.test.ts` (shape: blocks move out, A1).
- `src/admin.ts`, `src/admin.test.ts` (shape: `canDisable` block goes, B2).
- `src/sign-in.ts` (import path, A1), `src/invite.ts` (A3), `src/index.ts`.

**packages/db** (backend-dev):
- `src/accounts.ts` (B1, B2), `src/admin.ts` (B2), `src/account-delete.ts` (B3), `src/index.ts`.
- `test/account-lifecycle.test.ts` (new, B1 to B3).

**apps/web** (web-dev):
- `src/lib/onboarding-redirect.ts`, `onboarding-redirect.test.ts` (new, C1).
- `src/server/session.ts`, `src/app/pradzia/page.tsx`, `src/app/pradzia/actions.ts`, `src/app/k/[token]/page.tsx` (C1).
- `src/app/nustatymai/actions.ts`, `src/app/nustatymai/delete-section.tsx` (C2).

---

## Part A: the domain module

### Task A1: Move the predicates and deletion confirm; add the stage (backend-dev) - SECURITY

**Files:**
- Create: `packages/domain/src/account-lifecycle.ts`, `src/account-lifecycle.test.ts`
- Modify: `src/account.ts`, `src/sign-in.ts` (import), `src/index.ts`
- Test (shape only, as the spec lists): `src/account.test.ts` (the `isOnboarded`, `isDisabled`, `deletableAccount`, `canDelete` blocks, :59-79 and :91-166, move)

- [ ] **Step 1: Move the tests.** Cut the four blocks from `account.test.ts` into `account-lifecycle.test.ts` with their `account(over)` helper; change only the import (from `./account-lifecycle`). Run `pnpm --filter @mychess/domain test -- account`: the moved file fails (module missing), the rest of `account.test.ts` passes.
- [ ] **Step 2: Write the new tests** in `account-lifecycle.test.ts`:
  - `accountStage`: `{ onboardedAt: null, disabledAt: null }` is `notOnboarded`; onboarded only is `onboarded`; `disabledAt` set with `onboardedAt` null and with it set is `disabled`.
  - `deleteConfirmation`: `onboardedAt: null` is `email`; a date is `displayName`.
  - `isDisabled` accepts a `{ disabledAt }`-only object (a type-level use, as `InvitingCoach` needs).
  - Property (fast-check): `accountStage` is `disabled` iff `disabledAt !== null`; otherwise `onboarded` iff `onboardedAt !== null`.
- [ ] **Step 3:** Run `pnpm --filter @mychess/domain test -- account-lifecycle`. It fails.
- [ ] **Step 4: Implement.** Move `isOnboarded`, `isDisabled` (parameter `Pick<Account, 'disabledAt'>`), `DeletableAccount`, `deletableAccount`, `sameEmail`, `sameName`, `canDelete` with their doc comments into `account-lifecycle.ts`; `canDelete` branches on `deleteConfirmation(account) === 'email'`. Add `AccountStage`, `accountStage`, `DeleteConfirmation`, `deleteConfirmation` with doc comments naming R-80, R-81, R-82, R-86. `sign-in.ts` imports `isDisabled` from `./account-lifecycle`. `index.ts` exports the moved names from their new module (same names, nothing removed) and the new ones.
- [ ] **Step 5:** Run `pnpm --filter @mychess/domain test`. Everything passes, `sign-in.test.ts` and `invite.test.ts` unchanged. Run `pnpm --filter @mychess/web typecheck` if the package has it, else ask the lead to run the gate's typecheck: web imports must still resolve. Report.

### Task A2: The transitions (backend-dev) - SECURITY

**Files:**
- Modify: `packages/domain/src/account-lifecycle.ts`, `src/account-lifecycle.test.ts`, `src/index.ts`

- [ ] **Step 1: Write the tests.** `NOW = new Date('2026-10-22T09:00:00Z')`; `PROFILE = { displayName: 'Rūta', locale: 'en' }`.
  - `decideOnboarding`:
    - a not-onboarded, enabled account: `toEqual(ok({ profile: PROFILE, onboardedAt: NOW }))`;
    - onboarded: `refuse('lifecycle.alreadyOnboarded')`;
    - disabled and not onboarded, disabled and onboarded, `undefined`: `refuse('lifecycle.accountClosed')`.
  - `decideDisable` (the two cases of `admin.test.ts:33-43`, kept there until B2): enabled gives `ok({ disabledAt: NOW })`; `disabledAt` set gives `{ ok: false, refusal: { reason: 'admin.alreadyDisabled' } }`.
  - `decideDeletion`:
    - onboarded `Rūta`, `emailVerified: true`, `locale: 'en'`, typed `'  Rūta '`: `ok({ confirmationMail: { to: 'ruta@example.lt', locale: 'en' } })`;
    - the same with `emailVerified: false`: `ok({ confirmationMail: null })`;
    - not onboarded, typed `' Ruta@Example.LT '`: ok with the mail;
    - onboarded, typed `'ruta@example.lt'`: `refuse('account.deleteNameMismatch')`;
    - not onboarded, typed `'Rūta'`: `refuse('account.deleteEmailMismatch')`;
    - `undefined`, any text: `ok({ confirmationMail: null })`.
  - `LIFECYCLE_REFUSALS` equals the two keys and reasons of plan decision 2.
  - Properties (fast-check) over accounts with arbitrary `onboardedAt`, `disabledAt` (null or a date), `emailVerified`, `displayName` (including blank), and arbitrary typed text, plus the account's own name or email as typed:
    - `decideOnboarding(account, PROFILE, NOW).ok` iff `accountStage(account) === 'notOnboarded'`;
    - for a defined account, `decideDeletion(account, typed).ok === canDelete(account, typed).ok`;
    - when it is ok, `confirmationMail !== null` iff `account.emailVerified`, and then `to` and `locale` are the account's;
    - `canDelete(account, '   ').ok` is always false.
- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- account-lifecycle`. The new cases fail.
- [ ] **Step 3: Implement** `LIFECYCLE_REFUSALS`, `LifecycleRefusalReason`, `OnboardingRefusal`, `Onboarding`, `decideOnboarding` (order of plan decision 4, through `accountStage`), `decideDisable` (doc comment from `canDisable`), `AccountDeletion`, `decideDeletion` (on `canDelete` and `hasProvenEmail`). Use `ok` and `refuse` from `@mychess/chess`. Export them from `index.ts`. `canDisable` stays in `admin.ts` for now (plan decision 1).
- [ ] **Step 4:** Run the domain tests; they pass. Report.

### Task A3: R-108 through the module (backend-dev) - SECURITY

**Files:**
- Modify: `packages/domain/src/invite.ts`

- [ ] **Step 1:** Run `pnpm --filter @mychess/domain test -- invite` on the unchanged tree; note the result (the baseline, :154 in particular).
- [ ] **Step 2:** `isValid` uses `!isDisabled(coach)` from `./account-lifecycle` instead of `coach.disabledAt === null`. `InvitingCoach` is unchanged.
- [ ] **Step 3:** Run the domain tests; `invite.test.ts` passes unchanged. Check: `grep -rn "disabledAt === null\|onboardedAt === null" packages/domain/src` finds only `account-lifecycle.ts`. Report. The lead commits A1 to A3.

---

## Part B: decided on the locked row (db)

### Task B1: Onboarding once, under the lock (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/accounts.ts`, `src/index.ts` (only if a new type is exported)
- Create: `packages/db/test/account-lifecycle.test.ts`

- [ ] **Step 1:** Run `pnpm --filter @mychess/db test -- accounts admin` on the unchanged tree and note the result: the baseline.
- [ ] **Step 2: Write the tests** (`describe('completeOnboarding under the lock')`), with the seed helpers `accounts.test.ts` uses:
  - a new account: `ok()`, and the row has the name, language, `onboarded_at = NOW`, `updated_at = NOW`;
  - an onboarded account: `refuse('lifecycle.alreadyOnboarded')`, and `select * from accounts` is equal before and after;
  - a disabled account (onboarded or not) and an unknown id: `refuse('lifecycle.accountClosed')`, nothing written;
  - two calls at once on one new account (`Promise.all`, names `'Rūta'` and `'Jonas'`, times `NOW` and `LATER`): exactly one `ok`, the other `alreadyOnboarded`; the stored name and `onboarded_at` are the ok one's.
- [ ] **Step 3:** Run `pnpm --filter @mychess/db test -- account-lifecycle`. The new cases fail.
- [ ] **Step 4: Implement.** `completeOnboarding` opens `db.transaction`, `lockAccountById(tx, id)`, `decideOnboarding(account, profile, now)`; on success `setProfile(tx, id, { ...decision.value.profile, onboardedAt: decision.value.onboardedAt, updatedAt: now })` and return `ok()`; on refusal return it. Keep the doc comment and add the ruling (R-81) and "decided on the locked row".
- [ ] **Step 5:** Run `pnpm --filter @mychess/db test`. Everything passes; `accounts.test.ts` :115 and :283 unchanged. Report.

### Task B2: Disable once, under the lock; `canDisable` goes (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/accounts.ts`, `src/admin.ts`, `packages/domain/src/admin.ts`, `src/index.ts`
- Test (shape only, as the spec lists): `packages/domain/src/admin.test.ts` (the `canDisable` block, :33-43, goes; A2 holds its cases)
- Modify: `packages/db/test/account-lifecycle.test.ts`

- [ ] **Step 1: Write the test** (`describe('disableAccount under the lock')`): two `disableAccount` calls at once on one account (`NOW`, `LATER`, actor `ops`, `TEST_AUDIT_EMAIL_KEY`): one `ok()`, the other `refuse('admin.alreadyDisabled')`; exactly one `admin_audit` row; `disabled_at` is the ok call's `now`; the account has no session.
- [ ] **Step 2:** Run it. It fails (two audit rows).
- [ ] **Step 3: Implement.**
  - `accounts.ts`: `lockAccountByEmail(tx, email)`, the select of `lockAccountById` keyed by email (doc: `email` must be canonical; same lock).
  - `admin.ts` (db): `audited` reads with `lockAccountByEmail`; `AdminChange.check` returns `Result<unknown, AdminRefusal>`; `audited` returns `ok()` after the audit row (its answer stays `Result<undefined, AdminRefusal>`); `disableAccount`'s `check` is `(account) => decideDisable(account, input.now)`; `apply` unchanged.
  - Domain: delete `canDisable` and the `isDisabled` import from `admin.ts`; delete the `canDisable` block and its import from `admin.test.ts`; drop `canDisable` from `index.ts`.
- [ ] **Step 4:** Run `pnpm --filter @mychess/domain test` and `pnpm --filter @mychess/db test`. Everything passes, in particular db `admin.test.ts` :46, :74, :101, :122, :146, :170, `admin-command.test.ts` (all), `admin-audit.test.ts` (all). `grep -rn canDisable packages apps --include=*.ts` finds nothing outside `dist/`. Report.

### Task B3: Deletion decided under the lock (backend-dev) - SECURITY

**Files:**
- Modify: `packages/db/src/account-delete.ts`, `src/index.ts`, `packages/db/test/account-lifecycle.test.ts`

- [ ] **Step 1: Write the tests** (`describe('deleteConfirmedAccount')`), seeding an account with a session, a provider link and a magic-link token naming its email (as `accounts.test.ts:171` does):
  - onboarded `Rūta`, typed `'Ruta'`: `refuse('account.deleteNameMismatch')`; account, session, link and token counts unchanged;
  - typed `' Rūta '`: `ok({ confirmationMail: { to: 'ruta@example.lt', locale } })`; account, session, link and token gone, other accounts untouched;
  - `email_verified = false`: ok with `confirmationMail: null`, deleted;
  - not onboarded, typed `' Ruta@Example.LT '`: ok, deleted;
  - not onboarded when the caller read it, onboarded in the database before the call, typed the email: `refuse('account.deleteNameMismatch')`, nothing deleted (decided on the locked row);
  - an unknown id: `ok({ confirmationMail: null })`;
  - a coach with a live assignment to a player (the `forks.test.ts:466` setup): the player gets the automatic fork (R-49), as through `deleteAccount`;
  - two calls at once for one account: one returns the mail, the other `confirmationMail: null`; the account is gone.
- [ ] **Step 2:** Run `pnpm --filter @mychess/db test -- account-lifecycle`. The new cases fail.
- [ ] **Step 3: Implement.** In `account-delete.ts`: a private `removeLocked(tx, account, now)` with today's body after the lock (`forkForDeletingCoach`, the token delete, the account delete). `deleteAccount` keeps its signature, doc comment and behaviour: lock, return when missing, `removeLocked`. `deleteConfirmedAccount(db, { id, typed, now })`: `retryOnConflict(() => db.transaction(async (tx) => { const account = await lockAccountById(tx, id); const decision = decideDeletion(account, typed); if (decision.ok && account !== undefined) await removeLocked(tx, account, now); return decision; }), DELETE_ATTEMPTS)`. Its doc comment names R-40, R-82, R-86, R-87, the lock order (account row first) and #286. Export it from `index.ts`.
- [ ] **Step 4:** Run `pnpm --filter @mychess/db test`. Everything passes unchanged, in particular `accounts.test.ts` :171, :186, :210, :218, :496, :509; `forks.test.ts` :466 to :520 (#286 at :512); `shares.test.ts` :489, :656, :673, :732; `repertoires.test.ts` :123; `admin-audit.test.ts` :60. Report. The lead commits B1 to B3.

---

## Part C: web gates and adapts

### Task C1: Stage gates and onboarding (web-dev) - SECURITY

**Files:**
- Create: `apps/web/src/lib/onboarding-redirect.ts`, `onboarding-redirect.test.ts`
- Modify: `apps/web/src/server/session.ts`, `src/app/pradzia/page.tsx`, `src/app/pradzia/actions.ts`, `src/app/k/[token]/page.tsx`

- [ ] **Step 1:** Run `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature -- onboarding return-path session settings export oauth test-sign-in invites` on the unchanged tree and note the result: the baseline.
- [ ] **Step 2: Write the test** `onboarding-redirect.test.ts`: `{ reason: 'lifecycle.alreadyOnboarded' }` with `next = '/k/<token>'` gives that path, with `null` gives `ROUTES.home` (`/`); `{ reason: 'lifecycle.accountClosed' }` gives `ROUTES.signIn` (`/prisijungti`) with and without `next`. Run it; it fails.
- [ ] **Step 3: Implement** `onboardingRefusalPath` as a `Record<LifecycleRefusalReason, (next: string | null) => string>` lookup (total by type).
- [ ] **Step 4: The gates.**
  - `session.ts`: `getAccount` returns null for `account === undefined || accountStage(account) === 'disabled'`; `requireOnboarded` redirects to `ROUTES.onboarding` unless `accountStage(account) === 'onboarded'`. Export names, signatures and the `cache` wrapping unchanged; doc comments keep R-80 and R-81.
  - `pradzia/page.tsx`: `if (accountStage(account) === 'onboarded') redirect(next ?? ROUTES.home)`; still `requireAccount` (spec decision 9).
  - `pradzia/actions.ts`: the same early gate before `parseProfileInput`; then `const done = await completeOnboarding(getDb(), account.id, profile.value, new Date())`; `if (!done.ok) redirect(onboardingRefusalPath(done.refusal, next))` before `rememberLocale`; then as today.
  - `k/[token]/page.tsx`: `if (accountStage(account) !== 'onboarded') redirect(onboardingPath(back))`.
  - Drop the `isOnboarded` and `isDisabled` imports.
- [ ] **Step 5:** Run `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`. Everything passes unchanged, in particular:
  - `app/pradzia/page.test.tsx` :104, :109, :114, :121, :126, :131, :148, :172, :181;
  - `onboarding.test.ts` :38, :48, :60, :73, :80, :101;
  - `return-path.test.ts` :69, :79, :88, :97 to :157;
  - `session-helpers.test.ts` :37, :47, :55, :65;
  - `session.test.ts` :56; `export.test.ts` :178; `oauth.test.ts` :190; `test-sign-in.test.ts` :177;
  - `settings.test.ts` :116, :126; `invites.test.ts` :409.

  Report.

### Task C2: Deletion through the decision (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/app/nustatymai/actions.ts`, `src/app/nustatymai/delete-section.tsx`

- [ ] **Step 1: `deleteAccountAction`.** `requireAccount`; `typed` as today (`typeof typed === 'string' ? typed : ''`); `const deletion = await deleteConfirmedAccount(getDb(), { id: account.id, typed, now: new Date() })`; a refusal returns `{ refusal: deletion.refusal.reason }`; on success, `if (deletion.value.confirmationMail !== null) await mailDeleted(deletedMail(mail.locale, mail.to))`; then `signOutHere()` and the redirect as today. Remove the `canDelete`, `hasProvenEmail` and `deleteAccount` imports. The doc comment keeps R-40, R-82, R-86, R-87 and says the decision is made on the locked row.
- [ ] **Step 2: `delete-section.tsx`.** `ConfirmLabel` and `DeleteSection` read `deleteConfirmation(account) === 'email'` instead of `account.onboardedAt === null`; the button still waits for `canDelete(account, typed).ok`.
- [ ] **Step 3:** Run `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`. Everything passes unchanged, in particular:
  - `app/nustatymai/delete-section.test.tsx` (all), `app/nustatymai/page.test.tsx` :208, :238, `app/pradzia/page.test.tsx` :148, :181;
  - `settings.test.ts` `deleteAccountAction` :193, :210, :229, :245, the `it.each` at :255, :274, :286;
  - `magic-link.test.ts` :72; `prisijungti/page.test.tsx` :105; `sign-in-form.test.tsx` :216.
- [ ] **Step 4: The greps** (spec, "Done means"), in `apps/web/src` without tests:
  - `grep -rn "onboardedAt\|disabledAt" apps/web/src --include=*.ts --include=*.tsx | grep -v "\.test\."` finds only `server/auth.ts`'s field config;
  - no import of `isOnboarded`, `isDisabled`, `hasProvenEmail`, `canDisable` or `deleteAccount`.

  If knip then reports `isOnboarded`, `isDisabled` or `hasProvenEmail` unused in the domain index, drop them from `index.ts` (they stay module exports for `sign-in.ts`, `invite.ts` and the lifecycle module). Report. The lead commits C1 and C2.

### Task C3: E2E check (qa)

- [ ] Run `apps/web/e2e/settings.spec.ts` against the local build: the delete flow (:147) passes unchanged. Clean up any throwaway account it leaves. Report.

---

## Part D: close

### Task D1: Security review (security-reviewer) - SECURITY

- [ ] Review the A1 to C2 diff. Check:
  - a disabled account still opens no session (`auth.ts` `mayOpenSession` through the moved `isDisabled`), still reads as signed out (`getAccount`), and disabling still ends every session in the same transaction as the stamp and the one audit row;
  - `audited` locks the target before deciding; two disables cannot both audit;
  - `completeOnboarding` writes only for a `notOnboarded` stage, on the locked row; a disabled account cannot write its profile;
  - `deleteConfirmedAccount` decides on the locked row; a refused confirmation deletes nothing; the lock order is the account row first, as `deleteAccount` (S4, #286);
  - the deletion mail goes only to a proven address (R-87), and only once in a race;
  - R-108 still refuses a disabled coach's invite;
  - every race outcome of spec decision 7.

  Report findings to the lead.

### Task D2: Close (lead, architect)

- [ ] The lead runs `node quality/gate.mjs check` on the final tree; CI's mutation run on `account-lifecycle.ts` and the changed db and web files must be green.
- [ ] The architect runs `mp-code-review` on the diff since 7c7ea91 and checks the spec's "Done means"; then `improve-codebase-architecture` on the new and touched files, report to the lead.
- [ ] The lead takes the spec's product questions (1 to 6, including the glossary entries) to the owner.
- [ ] Close #267 with the commit range and the CI result.

---

## Self-review against the spec

| Spec item | Task |
| --- | --- |
| Decision 1: one pure, client-safe domain module | A1, A2 |
| Decision 2: moved, not layered; `canDisable` replaced | A1, B2 |
| Decision 3: the stage, web gates on it | A1, C1 |
| Decision 4: decisions on the locked row | B1, B2, B3 |
| Decision 5: the transitions | A2 |
| Decision 6: `LIFECYCLE_REFUSALS`, no catalogue entry | A2, C1 |
| Decision 7: race-only differences | B1, B2, B3 (tests), D1 |
| Decision 8: web mechanism; `onboardingRefusalPath` | C1, C2 |
| Decision 9: early gates stay; session export names unchanged | C1 |
| Decision 10: `deleteAccount` kept; `deleteConfirmedAccount` shares the body | B3 |
| Decision 11: `completeOnboarding` returns a `Result` | B1 |
| Decision 12: `audited` locks its target | B2 |
| Decision 13: R-108 through `isDisabled` | A3 |
| Decision 14: time is an input | A2, B1, B2 |
| Decision 15: domain language | D2 |
| Tests that change shape | A1 (`account.test.ts`), B2 (`admin.test.ts`) |
| Tests that must pass unchanged | every task's "Run" step, C3 |
| Done means | C2 step 4, D2 |

## Spec gaps for the owner

The six product questions of the spec: re-enabling, deleting a disabled account, disabling an Admin, a disabled coach's players, one deletion mail in a race, and the glossary entries. None blocks the plan, which keeps today's behaviour for each. If a task finds that a redirect, refusal reason, mail or check order cannot be kept exactly, the developer stops and the lead decides with the owner.
