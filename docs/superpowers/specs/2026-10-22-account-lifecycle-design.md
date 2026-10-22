# One Account lifecycle module (onboarding, disable, delete): design

Issue #267 (from the S1 architecture review, #251, candidate 2; report `C:\Users\tomyk\AppData\Local\Temp\architecture-review-s1-20261017-002325.html`). It follows #265 (sign-in policy, done: `packages/domain/src/sign-in.ts`), which already moved "a disabled account opens no session" into `canOpenSession`.

A deepening refactor with no product change: rulings, redirects, refusal reasons, catalogue keys, mails and every existing feature test stay as they are. No schema change, no migration, no catalogue change. The only observable differences are in races that today break a rule the code already states (listed under Lead decision 7); the security reviewer signs them off.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-80 | Sessions live in the database, so disabling or deleting an account ends them at once. A disabled account opens no session and reads as signed out |
| R-81 | The first sign-in asks for the display name and the language once (onboarding); an account that has been through it goes home, or on to the invite in `next` |
| R-82 | Deletion is confirmed by typing the display name; immediate and irreversible; a confirmation email afterwards |
| R-86 | An account that has not finished onboarding deletes itself by typing its email address instead |
| R-87 | mychess mails only a proven address: the deletion mail goes only to an account whose email was proven |
| R-40 | Hard delete (GDPR) |
| R-49, R-137 | Deleting a coach first forks every live assignment (unchanged; it stays in `forkForDeletingCoach`) |
| R-72, R-88, R-94 | Disabling is an Admin action from the CLI, audited once, the email hashed with the environment key |
| R-108 | An invite from a disabled coach is "not valid" |

Also kept: security checklist item 8 (disabled opens no session), the S4 lock order (account row first; `assignment-reach` spec and `shares.test.ts` :489, :732), #286 (the delete transaction runs again on a deadlock).

CLAUDE.md "rules live in domain objects", "refusals are values" and "a server action authenticates, loads, calls the domain method that decides, and saves" are the rules this refactor serves. ADR 0006 (one account, coach capability) is untouched.

## The problem, in the current code

The domain offers predicates only, and the rules that use them are spread over web and db:

1. **Onboarding happens once (R-81)** lives only in two redirects: `apps/web/src/app/pradzia/page.tsx:26` and `pradzia/actions.ts:33`. `packages/db/src/accounts.ts:87-94` `completeOnboarding` writes unconditionally, so two submits that both passed the check (two tabs) both write, the last name wins and `onboarded_at` moves.
2. **"Onboarded" gates** are repeated as `isOnboarded` calls in `server/session.ts:43` (`requireOnboarded`) and `app/k/[token]/page.tsx:35`.
3. **"Disabled means no way in" (R-80)** is enforced at three points with three spellings:
   - `apps/web/src/server/auth.ts:221-224` `mayOpenSession` (through `canOpenSession`, #265);
   - `apps/web/src/server/session.ts:30` `getAccount` (`isDisabled`);
   - `packages/db/src/admin.ts:90-108` `disableAccount` (stamps `disabled_at` and deletes the sessions; the check `canDisable` lives in `packages/domain/src/admin.ts:22-26`).
   And two more read the column directly: `packages/domain/src/invite.ts:113` (`coach.disabledAt === null`, R-108) and `sign-in.ts:190` (`isDisabled`).
4. **Disable once** (`canDisable`) is checked on a row `audited` reads without a lock (`admin.ts:77`, `findAccountByEmail`), so two concurrent disables both pass and write two audit rows.
5. **Deletion (R-82, R-86, R-87)** is decided in three places:
   - `packages/domain/src/account.ts:129-140` `canDelete` (which text confirms);
   - `apps/web/src/app/nustatymai/delete-section.tsx:92` and `:119` (`account.onboardedAt === null`: which text the form asks for, R-86, decided again in a component);
   - `apps/web/src/app/nustatymai/actions.ts:77-81` (whether the mail goes, `hasProvenEmail`, R-87), on the account the request read before `deleteAccount` (`packages/db/src/account-delete.ts:53-68`) locks it, so the decision is not made on the row that is deleted.
6. `isOnboarded`, `isDisabled`, `canDelete`, `deletableAccount` sit in `account.ts` beside the schema, email and entitlement rules; `canDisable` sits in `admin.ts`. Nothing names the Account's stages or its transitions.

## Lead decisions

None of these is a product rule.

1. **One new pure domain module**, `packages/domain/src/account-lifecycle.ts`. It imports only its domain siblings (`account.ts`, `admin.ts`) and `@mychess/chess` (`Result`, `ok`, `refuse`). It stays client-safe: `delete-section.tsx` (a client component) imports from it through `@mychess/domain`.
2. **Moved, not layered.** `isOnboarded`, `isDisabled`, `DeletableAccount`, `deletableAccount` and `canDelete` move from `account.ts` to `account-lifecycle.ts` with their names and doc comments. `canDisable` leaves `admin.ts` and is replaced by `decideDisable` (decision 5). `ACCOUNT_REFUSALS` and `ADMIN_REFUSALS` stay where they are, keys unchanged (`account.deleteNameMismatch`, `account.deleteEmailMismatch` are catalogue keys the delete form shows; `admin.alreadyDisabled` is what the CLI prints). `hasProvenEmail` stays in `account.ts` (it is R-87's email proof, not a stage).
3. **The stage.** One function names where an Account is in its life, with disabled taking precedence:
   ```ts
   export type AccountStage = 'notOnboarded' | 'onboarded' | 'disabled';
   export function accountStage(account: Pick<Account, 'onboardedAt' | 'disabledAt'>): AccountStage;
   ```
   Web gates on it: `getAccount` treats `disabled` as signed out; `requireOnboarded`, the onboarding page and action, and the invite page gate on `onboarded`. `isOnboarded` and `isDisabled` stay as module helpers (`sign-in.ts` and `invite.ts` use `isDisabled`) but leave the package index once web no longer imports them (knip).
4. **Transitions are decisions that return values, made on the locked row.** Each db function that applies one locks the account row (`FOR NO KEY UPDATE`, the S4 lock), asks the domain, and writes only what the domain allowed, in one transaction, the same shape as `editRepertoire` (#276). The domain decides on `Account | undefined` where the row can be gone, as `decideProviderJoin` does.
5. **The transitions:**
   - `decideOnboarding(account: Account | undefined, profile: Profile, now: Date): Result<Onboarding, OnboardingRefusal>`, `Onboarding = { profile: Profile; onboardedAt: Date }`. Refusals, in this order: no account or a disabled one is `lifecycle.accountClosed`; an onboarded one is `lifecycle.alreadyOnboarded`.
   - `decideDisable(account: Account, now: Date): Result<{ disabledAt: Date }, AdminRefusal>`: `admin.alreadyDisabled` when disabled (today's `canDisable`). An unknown email stays `admin.accountNotFound`, refused in `audited` before the domain is asked, as today.
   - `deleteConfirmation(account: Pick<Account, 'onboardedAt'>): 'displayName' | 'email'`: what the person types to confirm (R-82, R-86). `canDelete` uses it; the delete form asks it instead of reading `onboardedAt`.
   - `canDelete(account, typed)`: unchanged ("confirm-delete"; the client keeps using it to enable the button).
   - `decideDeletion(account: Account | undefined, typed: string): Result<AccountDeletion, AccountRefusal>`, `AccountDeletion = { confirmationMail: { to: string; locale: Locale } | null }`. A missing account is `ok({ confirmationMail: null })` (it is already gone; nothing to confirm or mail). Otherwise `canDelete` decides; on success the mail goes to the account's email in its locale only when `hasProvenEmail` (R-82, R-87), else `null`.
6. **The new refusal set** `LIFECYCLE_REFUSALS = { alreadyOnboarded: 'lifecycle.alreadyOnboarded', accountClosed: 'lifecycle.accountClosed' } as const`. Neither reaches the UI as text: the onboarding action answers both with a redirect (decision 8), so no catalogue entry is added (the #265 precedent, `SIGN_IN_REFUSALS`).
7. **Race-only differences** (the rule was already stated; it now holds under concurrency). The security reviewer signs each off:
   - Two onboarding submits at once: the first writes; the second is refused `alreadyOnboarded` and goes on to `next` or home without writing (today the last one overwrites name, language and `onboarded_at`). Matches `onboarding.test.ts:80` ("an onboarded account goes home without writing anything").
   - An onboarding submit for an account disabled since the request read it: refused `accountClosed`, sent to sign-in, nothing written (today it writes the profile of a disabled account).
   - Two `admin:disable` runs at once: one disables and audits; the other prints `admin.alreadyDisabled` (today: two audit rows and a moved `disabled_at`).
   - A delete confirmed against the account as the request read it, but onboarded since (another tab): decided on the locked row, so the typed email no longer confirms and it is refused `account.deleteNameMismatch`, nothing deleted.
   - Two delete submits at once: the second finds no row and gets `ok({ confirmationMail: null })`: it signs the browser out and redirects as today, but sends no second mail (R-82: "a confirmation email").
8. **What stays in web**, because it is HTTP or Next.js mechanism: reading the form, `returnPath`, `redirect`, the locale cookie, `signOutHere`, sending the mail (`getMailer`, `deletedMail`) and the mail-failure logging. The onboarding action maps a refusal to a path through one pure function, `onboardingRefusalPath(refusal, next)` in `apps/web/src/lib/onboarding-redirect.ts` (`alreadyOnboarded` to `next ?? ROUTES.home`, `accountClosed` to `ROUTES.signIn`), typed on the refusal reason so a new reason fails typecheck.
9. **The early gates stay.** `pradzia/page.tsx`, `pradzia/actions.ts` and `k/[token]/page.tsx` keep their own gate on the request's account (`accountStage(account) === 'onboarded'`), before parsing the form, so an onboarded account posting an invalid form still goes home (today's order) and the unit tests that mock `requireAccount` keep working. The locked decision is the second line. The names the session module exports (`getAccount`, `requireAccount`, `requireOnboarded`, `hasFreshSession`) do not change: seven unit tests mock them by name.
10. **db keeps an undecided delete.** `deleteAccount(db, id, now?)` stays exported and unchanged: twelve db and feature tests call it directly to set up or assert the cascade. A new `deleteConfirmedAccount(db, { id, typed, now })` locks, asks `decideDeletion`, and runs the same body; both share one private `removeLocked(tx, account, now)`, so the lock order and the #286 retry are the same code. The server action calls only `deleteConfirmedAccount`.
11. **`completeOnboarding` changes its answer, not its name or arguments.** It returns `Promise<Result<undefined, OnboardingRefusal>>` instead of `Promise<void>`. Its test callers (`packages/db/test/accounts.test.ts:118`, `:288`, `apps/web/test/feature/support/auth.ts:117`) await it on a fresh account and ignore the answer, so they pass unchanged.
12. **`disableAccount` locks its target.** `audited` (`admin.ts:71-93`) reads the target with a new `lockAccountByEmail(tx, email)` (the same columns and lock as `lockAccountById`) instead of `findAccountByEmail`. `grantAdmin` goes through it too; it does not decide on the row, so the lock only orders it.
13. **R-108 through the module.** `invite.ts` `isValid` asks `isDisabled(coach)`; `isDisabled` takes `Pick<Account, 'disabledAt'>` so `InvitingCoach` fits without change.
14. **Time is an input.** `decideOnboarding` and `decideDisable` take `now`; the callers pass the `now` they already have.
15. **Domain language.** `docs/CONTEXT.md` has no entry for onboarding, a disabled account or account deletion, and this design adds the code words "stage", `notOnboarded`, `accountClosed`. This refactor does not edit CONTEXT.md; the lead takes proposed entries to the owner (Product questions, 6).

## Design

### Domain (`packages/domain`)

**`src/account-lifecycle.ts` (new):**

- Moved from `account.ts`, unchanged in behaviour: `isOnboarded`, `isDisabled` (now on `Pick<Account, 'disabledAt'>`), `DeletableAccount`, `deletableAccount`, `canDelete` (with its private `sameEmail`, `sameName`; it branches on `deleteConfirmation`).
- `AccountStage`, `accountStage` (decision 3).
- `LIFECYCLE_REFUSALS`, `type LifecycleRefusalReason`, `interface OnboardingRefusal { readonly reason: LifecycleRefusalReason }`.
- `Onboarding`, `decideOnboarding` (decision 5).
- `decideDisable` (decision 5; doc comment carries `canDisable`'s: "disabling again would only add a second audit row and move the disable time").
- `DeleteConfirmation = 'displayName' | 'email'`, `deleteConfirmation`.
- `AccountDeletion`, `decideDeletion`.
- Each function stays at cyclomatic complexity <= 10; `decideOnboarding` and `decideDeletion` branch on `accountStage` / `deleteConfirmation`.

**`src/account.ts`:** loses the moved functions; keeps `LOCALES`, `ENTITLEMENTS`, `ACCOUNT_REFUSALS`, `accountSchema`, `AccountRef`, `profileSchema`, `canonicalEmail`, `hasProvenEmail`, `entitlementLimits`.

**`src/admin.ts`:** loses `canDisable` and its `isDisabled` import; keeps `ADMIN_ACTIONS`, `ADMIN_REFUSALS`, `AdminRefusal`.

**`src/sign-in.ts`:** imports `isDisabled` from `./account-lifecycle`; nothing else changes.

**`src/invite.ts`:** `isValid` uses `isDisabled(coach)` (decision 13).

**`src/index.ts`:** exports `accountStage`, `AccountStage`, `LIFECYCLE_REFUSALS`, `OnboardingRefusal`, `Onboarding`, `decideOnboarding`, `decideDisable`, `deleteConfirmation`, `DeleteConfirmation`, `decideDeletion`, `AccountDeletion`, `canDelete`, `deletableAccount`, `DeletableAccount`. Drops `canDisable`; drops `isOnboarded`, `isDisabled` and `hasProvenEmail` if knip reports them unused after Part C (they stay exported only while something outside the package imports them).

### Database (`packages/db`)

- **`src/accounts.ts`:**
  - new `lockAccountByEmail(tx, email)` (decision 12);
  - `completeOnboarding(db, id, profile, now)`: one transaction: `lockAccountById`, `decideOnboarding(account, profile, now)`, on success `setProfile(tx, id, { ...decision.profile, onboardedAt: decision.onboardedAt, updatedAt: now })`; returns the decision without its value (`Result<undefined, OnboardingRefusal>`). `updateProfile` unchanged.
- **`src/admin.ts`:** `audited` locks with `lockAccountByEmail`; `disableAccount`'s `check` is `(account) => decideDisable(account, input.now)` and its `apply` writes `disabled_at` from the decision and deletes the sessions, as today. `AdminChange.check` returns `Result<unknown, AdminRefusal>`; `audited` still returns `Result<undefined, AdminRefusal>`. The CLI (`bin/admin-command.ts`, `bin/admin-disable.ts`) is unchanged.
- **`src/account-delete.ts`:** private `removeLocked(tx, account, now)` (the fork, the token delete, the account delete); `deleteAccount` = lock, return if missing, `removeLocked` (unchanged behaviour); new `deleteConfirmedAccount(db, { id, typed, now })`: inside the same `retryOnConflict(..., DELETE_ATTEMPTS)` transaction, `lockAccountById`, `decideDeletion(account, typed)`, on success with an account `removeLocked`; returns the decision.
- **`src/index.ts`:** exports `deleteConfirmedAccount`.

### Web (`apps/web`)

- **`src/server/session.ts`:** `getAccount`: `account === undefined || accountStage(account) === 'disabled' ? null : account`; `requireOnboarded`: redirect to onboarding unless `accountStage(account) === 'onboarded'`. Export names and signatures unchanged.
- **`src/app/pradzia/page.tsx`:** the gate is `accountStage(account) === 'onboarded'`; nothing else changes.
- **`src/app/pradzia/actions.ts`:** the early gate as the page; then `parseProfileInput`; then `const done = await completeOnboarding(getDb(), account.id, profile.value, new Date())`; a refusal redirects to `onboardingRefusalPath(done.refusal, next)` with no cookie written; success remembers the locale and redirects as today.
- **`src/lib/onboarding-redirect.ts` (new):** `onboardingRefusalPath` (decision 8), a `Record<LifecycleRefusalReason, (next: string | null) => string>`.
- **`src/app/k/[token]/page.tsx`:** `accountStage(account) !== 'onboarded'` sends to `onboardingPath(back)`.
- **`src/app/nustatymai/actions.ts`:** `deleteAccountAction`: `requireAccount`, the typed text as today, `deleteConfirmedAccount(getDb(), { id: account.id, typed, now: new Date() })`; a refusal returns `{ refusal: reason }`; success mails `confirmationMail` when it is not `null` (through `mailDeleted`, unchanged), signs out and redirects as today. No `canDelete`, `hasProvenEmail` or `deleteAccount` import.
- **`src/app/nustatymai/delete-section.tsx`:** `ConfirmLabel` and the input type ask `deleteConfirmation(account) === 'email'` instead of `account.onboardedAt === null`.

### Not in scope

- `auth.ts` `mayOpenSession` and `canOpenSession`: already the domain's (#265); they keep working through the moved `isDisabled`.
- Profile changes from settings (`updateProfile`), the data export, the persona sign-in: unchanged.
- Re-enabling an account, deleting a disabled account, an Admin-initiated delete: no ruling (Product questions).
- What disabling a coach does to their links, groups and assignments beyond R-108: no ruling.

## Testing

### New domain unit tests (`packages/domain/src/account-lifecycle.test.ts`, no database)

- **Moved from `account.test.ts`, cases unchanged:** `isOnboarded` (:59-67), `isDisabled` (:69-79), `deletableAccount` (:91-99), `canDelete` (:101-166, every case including the R-86 block and the blank-name case).
- **`accountStage`:** the four `{ onboardedAt, disabledAt }` combinations: neither is `notOnboarded`; onboarded only is `onboarded`; disabled with or without onboarding is `disabled`.
- **`deleteConfirmation`:** `onboardedAt: null` is `email`; set is `displayName`.
- **`decideOnboarding`:** a not-onboarded enabled account gives `ok({ profile, onboardedAt: now })` (exactly, `toEqual`); onboarded gives `lifecycle.alreadyOnboarded`; disabled (onboarded or not) and `undefined` give `lifecycle.accountClosed`.
- **`decideDisable`** (the cases of `admin.test.ts:33-43`, moved): enabled gives `ok({ disabledAt: now })`; disabled gives `admin.alreadyDisabled`.
- **`decideDeletion`:** onboarded and the name typed gives `ok({ confirmationMail: { to: email, locale } })`; with `emailVerified: false` gives `confirmationMail: null`; not onboarded and the email typed in another case gives the mail; a mismatch gives `account.deleteNameMismatch` / `account.deleteEmailMismatch`; `undefined` gives `ok({ confirmationMail: null })`.
- **Properties (fast-check)** over accounts with arbitrary `onboardedAt`, `disabledAt`, `emailVerified`, `displayName`, `email` and typed text:
  - `accountStage` is `disabled` iff `disabledAt` is set;
  - `decideOnboarding` is ok iff the stage is `notOnboarded`;
  - `decideDeletion` is ok iff `canDelete` is ok (for a defined account), and its mail is non-null iff `emailVerified`;
  - `canDelete` never confirms a blank typed text.
- **`invite.test.ts`:** unchanged; it pins decision 13.

### New db tests (`packages/db/test/account-lifecycle.test.ts`, Testcontainers)

- `completeOnboarding`: returns `ok` and writes for a new account; for an onboarded one returns `lifecycle.alreadyOnboarded` and the row is byte-equal before and after; a disabled one and an unknown id return `lifecycle.accountClosed` and write nothing; two concurrent calls with different names: exactly one is `ok`, the other `alreadyOnboarded`, and the stored name and `onboarded_at` are the winner's.
- `disableAccount`: two concurrent runs on one account: one `ok`, one `admin.alreadyDisabled`, exactly one audit row, `disabled_at` is the winner's `now`.
- `deleteConfirmedAccount`:
  - a wrong name deletes nothing (accounts, sessions, provider links, tokens counted before and after) and returns `account.deleteNameMismatch`;
  - the name deletes everything `deleteAccount` deletes (the cases of `accounts.test.ts:171`) and returns the mail; an unproven email returns `confirmationMail: null`;
  - a not-onboarded account confirmed by its email in another case is deleted;
  - an account onboarded after the caller read it is refused when the email is typed (decided on the locked row);
  - an unknown id returns `ok({ confirmationMail: null })`;
  - a coach with a live assignment: the player gets the automatic fork (R-49), as through `deleteAccount`.

### New web unit test

- **`apps/web/src/lib/onboarding-redirect.test.ts`:** `alreadyOnboarded` with `next` goes to `next`, without to `/`; `accountClosed` goes to `/prisijungti` whatever `next` is.

### Tests that change shape, not meaning

- `packages/domain/src/account.test.ts`: the `isOnboarded`, `isDisabled`, `deletableAccount` and `canDelete` blocks (:59-79, :91-166) move to `account-lifecycle.test.ts`; their imports go. Every other block stays byte for byte.
- `packages/domain/src/admin.test.ts`: the `canDisable` block (:33-43) moves to `account-lifecycle.test.ts` as `decideDisable` (same two cases; the success now carries `{ disabledAt: now }`). The vocabulary block (:20-31) stays byte for byte.

Every other test stays as it is, byte for byte. If one fails, the code is wrong, not the test.

### Tests that must pass unchanged

**Domain unit:** `account.test.ts` (remaining blocks: `canonicalEmail` :35, `hasProvenEmail` :81, `entitlementLimits` :168, constants :177, `profileSchema` :201, `accountSchema` :226); `admin.test.ts` :20; `sign-in.test.ts` (all, in particular `canOpenSession` :179 and the disabled join :231); `invite.test.ts` (all, in particular :154, R-108).

**db (Testcontainers):**
- `accounts.test.ts` (all): `completeOnboarding` :115 and `updateProfile` :142; `deleteAccount` :171, :186, :210, :218; export :283; coaching on delete :496, :509.
- `admin.test.ts` (all): :46 the audit row; `grantAdmin` :74, :101; `disableAccount` :122 (stamps, ends sessions, audits once), :146 (already disabled: nothing changes, no audit), :170 (unknown email).
- `admin-command.test.ts` (all): :76, :90, :100 (disable verb), :115, :125, :141, :178, :187, and `cliActor` :199-:214.
- `admin-audit.test.ts` (all), in particular :60 (an audited account can still be deleted).
- `forks.test.ts` :466, :489, :500, :507, :512 (#286 retry), :520.
- `shares.test.ts` :489 and :732 (the lock order a delete takes), :656, :673.
- `repertoires.test.ts` :123; `schema.test.ts` :345, :357, :423; `invites.test.ts` :465 (R-108).

**Web unit (`test:component`):**
- `app/pradzia/page.test.tsx` (all): :104, :109, :114 (onboarded goes home or to the invite), :121, :126, :131, :148 (delete by email, R-86), :172, :181.
- `app/pradzia/onboarding-form.test.tsx` (all).
- `app/nustatymai/delete-section.test.tsx` (all): :63-:164 (R-82), :176, :185, :195 (R-86).
- `app/nustatymai/page.test.tsx` (all), in particular :208 and :238.
- `app/prisijungti/page.test.tsx` :105, `app/prisijungti/sign-in-form.test.tsx` :216 (the "deleted" note).
- `server/test-sign-in.test.ts` :120 (disabled 403).
- The tests that mock the session module by name: `app/fork-offer-actions.test.ts`, `app/repertuarai/priskirti/[id]/actions.test.ts`, `server/assignment-pages.test.ts`, `server/coach-assignments.test.ts`.

**Web feature (`web-feature`, Testcontainers), all of the project; these exercise the moved rules:**
- `onboarding.test.ts` (all): :38, :48, :60, :73, :80 (onboarded: home, nothing written, no cookie), :101.
- `return-path.test.ts` (all): :69, :79, :88 (onboarded goes on to the invite), :97, :102, :111, :115, :120, :138, :157.
- `session.test.ts` (all): :30, :38, :47, :56 (disable ends sessions, no new one).
- `session-helpers.test.ts` (all): :37, :47 (new account to onboarding), :55, :65 (disabled reads as signed out), :83, :89.
- `settings.test.ts`: `updateProfileAction` :75, :93, :104, :116 (not onboarded goes to onboarding), :126; `deleteAccountAction` :193, :210 (deletes, mails in its language, signs out), :229 (mail failure), :245, the R-86 `it.each` at :255, :274, :286 (unproven: no mail).
- `export.test.ts` :178 (disabled 401); `oauth.test.ts` :190 (disabled opens no session); `test-sign-in.test.ts` :177; `invites.test.ts` :409 (R-108); `magic-link.test.ts` :72 (hard delete finds the token).

**E2E:** `apps/web/e2e/settings.spec.ts` (the delete flow, :147), run by qa against the local build.

## Done means

- Every lifecycle decision is made by a function in `packages/domain/src/account-lifecycle.ts`, with the unit and property tests above: the stage, onboarding, disable, which text confirms a deletion, whether it confirms, and whether the mail goes.
- `completeOnboarding`, `disableAccount` and `deleteConfirmedAccount` decide on the locked row and write only what the domain allowed (the db tests above, including the concurrent ones).
- A grep finds, in `apps/web/src` (tests excluded):
  - no `onboardedAt` or `disabledAt` outside `server/auth.ts`'s Better Auth field config;
  - no import of `isOnboarded`, `isDisabled`, `hasProvenEmail`, `canDisable` or `deleteAccount`.
- No `canDisable` anywhere; no `disabledAt === null` or `onboardedAt === null` outside `packages/domain/src/account-lifecycle.ts`.
- Every redirect, refusal reason, mail and status is the same outside the races of decision 7: the whole `web-feature` project and every test listed above pass unchanged; only the two blocks under "Tests that change shape" moved.
- Mutation testing in CI is green on `account-lifecycle.ts` and on the changed db and web files.
- The gate is green.
- `security-reviewer` signs off: disable, deletion and the session gate moved, and decision 7's race outcomes.
- #267 closes.

## Product questions

The rulings leave these open. None blocks this refactor, which keeps today's behaviour for each; the lead takes them to the owner.

1. **Re-enabling.** Is there a way back for a disabled account (an `admin:enable`)? No ruling; today there is none, and this design adds none.
2. **Deleting a disabled account.** A disabled account cannot sign in, so it cannot delete itself (R-40 hard delete). Should an Admin be able to delete it, or should the person be able to ask? No ruling.
3. **Disabling an Admin.** May an Admin account, the owner's own included, be disabled? Today yes (`decideDisable` checks only "already disabled"); no ruling says either way.
4. **A disabled coach's players.** R-108 covers invites only. Do a disabled coach's links, shares, groups and live assignments stay as they are (today), or do players get fork offers as on unlink (R-44)? No ruling.
5. **The second delete in a race** (decision 7): it now sends no second confirmation mail. R-82 says "a confirmation email"; confirm that one mail is intended.
6. **Glossary wording** (no code depends on it): `docs/CONTEXT.md` has no entries for onboarding, a disabled account or account deletion. Proposed: "**Onboarding**: the one screen a new Account goes through after its first sign-in, setting its Profile (R-81); an Account that has not finished it may still delete itself (R-86)." "**Disabled account**: an Account an Admin has disabled; it has no session and reads as signed out (R-80), and its invites are not valid (R-108)." "**Account deletion**: the immediate, irreversible hard delete an Account confirms itself (R-40, R-82, R-86)." The code word "stage" (`notOnboarded`, `onboarded`, `disabled`) would then follow the glossary.
