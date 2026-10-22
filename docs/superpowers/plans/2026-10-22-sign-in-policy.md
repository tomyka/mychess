# Sign-in Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sign-in decision (canonical email and blank name, client OAuth fields, fresh session to link, the Lichess link guard, the implicit join, disabled account opens no session, the provider-callback session, the R-90 notice, the persona sign-in) a pure function in `packages/domain` with exhaustive unit tests. The Better Auth hooks in `apps/web/src/server/` only read Better Auth's input, call the domain and map the refusal to today's wire answer. Behaviour, wire codes and every feature test stay unchanged. Better Auth stays (ADR 0010).

**Architecture:**
- **Domain** (`packages/domain/src/sign-in.ts`, `persona-sign-in.ts`, both new): providers, `SIGN_IN_REFUSALS`, `signInEmail`, `magicLinkRequest`, `canStartOAuth`, `FRESH_AGE_SECONDS`, `isFreshSession`, `canLinkProvider`, `decideProviderJoin`, `canOpenSession`, `providerSessionStands`, `leavesLichessNotice`, `showsLichessNotice`; `personaEmail`, `personaSignInAvailable`.
- **Web** (`apps/web/src/server/`): new `auth-refusal.ts` (the one table from refusal to wire answer); `auth.ts`, `provider-session.ts`, `lichess-unlinked.ts`, `test-sign-in.ts` and `session.ts` call the domain. `implicit-join.ts` and `session-freshness.ts` are deleted.
- **Database:** no change.

**Tech Stack:** Better Auth 1.7.10, Next.js App Router, zod 4, vitest 4 (the `web-feature` project on Testcontainers), fast-check.

**Spec:** `docs/superpowers/specs/2026-10-22-sign-in-policy-design.md` (the lead commits it from the scratchpad). **Issue:** #265, folding in its comment (implicit join, #270 advisory 3). **Rulings kept:** R-69, R-73, R-80, R-81, R-83, R-84, R-87, R-90, R-93, R-95. **ADR:** 0010.

**Roles:** each task names its role. Every task is `- SECURITY` and goes through `security-reviewer`. No task is UX or i18n: there is no visible change and no catalogue change. Per task, the order is:
1. the developer, test first;
2. `qa`, which checks that the existing tests still pass unchanged, except those the spec lists under "Tests that change shape";
3. `architect` (`mp-code-review` on the task's diff);
4. `security-reviewer`;
5. the lead commits.

**Rules for every task** (CLAUDE.md):
- Test first.
- No suppression comments, no `any`, no `!`.
- Complexity <= 10, CRAP <= 30.
- Refusals are `Result` values; exceptions only for programmer errors.
- A teammate runs only their own package's tests: backend-dev runs `pnpm --filter @mychess/domain test`; web-dev runs `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`.
- The lead runs `node quality/gate.mjs check` once before each commit (no pipe into `tail`).
- Nobody runs mutation testing locally (#273).
- **Behaviour-preserving:** a test that is not listed in the spec's "Tests that change shape" must not be edited. If one fails, the code is wrong, not the test. The developer stops and reports.

**Migration:** none.

**Commits:** the lead commits at three checkpoints:
- after A3: `refactor(domain): sign-in and persona sign-in rules as pure decisions (#265)`;
- after B2: `refactor(web): auth request and session hooks decide through the domain (#265)`;
- after B4: `refactor(web): provider joins, provider sessions, the Lichess notice and the persona sign-in through the domain; implicit-join and session-freshness gone (#265)`.

Part A only adds to the domain; nothing in web uses it until B. If knip flags a new domain export as unused at the A3 checkpoint, the lead holds the commit until B2 instead of suppressing.

---

## Verified library API

Checked against the installed packages while planning (2026-10-22). A worker who finds a difference stops and tells the lead.

- **better-auth 1.7.10** (`node_modules/.pnpm/better-auth@1.7.10_*/node_modules/better-auth/dist/`):
  - `db/revoke-unproven-account-access.mjs:33-56`: `revokeUnprovenAccountAccess(ctx, userId)` takes a cleanup lock (a verification row), re-reads the user, returns it untouched when `emailVerified` is already true, and otherwise deletes every provider link and session and sets `emailVerified: true`. Spec decision 6 relies on this: the adapter keeps calling it for every allowed Google join.
  - The hook shapes the adapter keeps are the ones `auth.ts` types today: `ValidateUserInfo` (`UserOptions['validateUserInfo']`, :55), `DatabaseHooks` (:56), `HookContext` (:123), `getOAuthState()` (:207). B tasks change no type here.
- **The code this plan builds on:**
  - `apps/web/src/server/auth.ts:58-248`;
  - `implicit-join.ts:1-39` and `implicit-join.test.ts`;
  - `session-freshness.ts` and its test;
  - `provider-session.ts:38-50`;
  - `lichess-unlinked.ts:14-61`;
  - `test-sign-in.ts:17-36`;
  - `session.ts:9`, `:46-51`;
  - `lib/providers.ts`, `lib/providers.test.ts:4-12`, `lib/sign-in-errors.ts`;
  - domain `account.ts:62-84` (`canonicalEmail`, `isDisabled`, `ACCOUNT_REFUSALS`), `@mychess/chess` `result.ts` (`ok`, `refuse`, `Result`).

---

## Decisions taken while planning

None of these is a product rule.

1. **Module split.** `sign-in.ts` for the account sign-in rules, `persona-sign-in.ts` for R-73/R-93. Each function stays small; `decideProviderJoin` delegates to private `settingsLink` and `emailJoin`.
2. **The refusal shape.**

```ts
export const SIGN_IN_REFUSALS = {
  lichessEmailInUse: 'signIn.lichessEmailInUse',
  joinRefused: 'signIn.joinRefused',
  sessionNotFresh: 'signIn.sessionNotFresh',
  clientOAuthField: 'signIn.clientOAuthField',
  accountDisabled: 'signIn.accountDisabled',
} as const;

export type SignInRefusalReason =
  (typeof SIGN_IN_REFUSALS)[keyof typeof SIGN_IN_REFUSALS];

export type SignInRefusal =
  | { readonly reason: Exclude<SignInRefusalReason, 'signIn.clientOAuthField'> }
  | { readonly reason: 'signIn.clientOAuthField'; readonly field: string };
```

   `canStartOAuth` returns `refuse(SIGN_IN_REFUSALS.clientOAuthField, { field })`.
3. **The join input and answer** are the spec's `ProviderJoin` and `JoinAllowed`, verbatim.
4. **The wire table** (`apps/web/src/server/auth-refusal.ts`):

```ts
const ANSWERS: Record<SignInRefusalReason, { status: 'BAD_REQUEST' | 'FORBIDDEN' | 'UNAUTHORIZED'; code: string }> = {
  'signIn.lichessEmailInUse': { status: 'BAD_REQUEST', code: LICHESS_EMAIL_IN_USE },
  'signIn.joinRefused': { status: 'BAD_REQUEST', code: JOIN_REFUSED },
  'signIn.sessionNotFresh': { status: 'FORBIDDEN', code: SESSION_NOT_FRESH },
  'signIn.clientOAuthField': { status: 'BAD_REQUEST', code: 'unsupported_oauth_field' },
  'signIn.accountDisabled': { status: 'UNAUTHORIZED', code: 'unable_to_create_session' },
};
```

   - `refusalError(refusal)` builds `new APIError(status, { code, message })`, where `message` is the field for `clientOAuthField` and the code otherwise; for an `AccountRefusal` it is `APIError('BAD_REQUEST', { code: reason, message: reason })`, as `canonicalOrRefuse` does today.
   - `refusalCode(refusal)` returns `ANSWERS[refusal.reason].code`, for `validateUserInfo`'s `{ error }`.
   - The two join rows' `status` is unused by `validateUserInfo` (Better Auth picks the redirect); it is set so the table stays total. The `accountDisabled` row documents Better Auth's own answer; the session hook returns `false`, not this error.
5. **`isFreshSession` drops its default `now`.** Its two callers (`auth.ts` `refuseStaleLink`, `session.ts` `hasFreshSession`) pass `new Date()`.
6. **`lib/providers.ts`** becomes:

```ts
import { PROVIDERS, type Provider } from '@mychess/domain';

/** The providers to offer: Google only when the server has its credentials. */
export const offeredProviders = (googleEnabled: boolean): Provider[] =>
  PROVIDERS.filter((provider) => googleEnabled || provider !== 'google');
```

---

## File structure

**packages/domain** (backend-dev):
- `src/sign-in.ts`, `src/sign-in.test.ts` (new, A1, A2).
- `src/persona-sign-in.ts`, `src/persona-sign-in.test.ts` (new, A3).
- `src/index.ts`: exports.

**apps/web** (web-dev):
- `src/server/auth-refusal.ts`, `auth-refusal.test.ts` (new, B1).
- `src/server/auth.ts` (B2, B3).
- `src/server/session.ts`, `src/lib/providers.ts`, `src/lib/providers.test.ts` (the `isProvider` block only), `src/app/nustatymai/providers.tsx`, `src/app/prisijungti/sign-in-form.tsx`, `src/server/provider-links.ts` (B2).
- `src/server/provider-session.ts`, `src/server/lichess-unlinked.ts` (B3).
- `src/server/test-sign-in.ts` (B4).
- Deleted: `src/server/session-freshness.ts` and test (B2), `src/server/implicit-join.ts` and test (B3).

---

## Part A: rules (domain)

### Task A1: Providers, email, OAuth start, freshness, opening a session (backend-dev) - SECURITY

**Files:**
- Create: `packages/domain/src/sign-in.ts`, `src/sign-in.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the tests** (spec, "New domain unit tests"):
  - `isProvider`: `google`, `lichess` known; `credential`, `Google`, `''` not. `PROVIDERS` equals `['google', 'lichess']` in that order (`offeredProviders` relies on it).
  - `signInEmail`: `' Ruta@Example.lt '`, `'RUTA@EXAMPLE.LT'`, `'ｒｕｔａ@ｅｘａｍｐｌｅ.ｌｔ'` give `ok('ruta@example.lt')`; `'rutа@example.lt'` (Cyrillic а), `''`, `undefined`, `null`, `1` give `refuse('account.emailInvalid')`.
  - `magicLinkRequest`: the same inputs; success is exactly `{ email: 'ruta@example.lt', name: '' }` (`toEqual`, so no extra key).
  - `canStartOAuth`:
    - `[]`, `['provider', 'callbackURL', 'disableRedirect', 'errorCallbackURL']` and `['Scopes']` are `ok()`;
    - each of `scopes`, `additionalParams`, `loginHint`, `idToken` alone is `{ ok: false, refusal: { reason: 'signIn.clientOAuthField', field } }`;
    - `['idToken', 'scopes']` names `scopes` (list order, not request order).
  - `isFreshSession(createdAt, now)` with `NOW = 2026-10-17T12:00:00Z`: 0 h and 23 h true; 24 h and 25 h false; 24 h minus 1 ms true; 1 h after `now` true. `FRESH_AGE_SECONDS` is `86_400`.
  - `canLinkProvider`: 23 h is `ok()`; 24 h is `refuse('signIn.sessionNotFresh')`.
  - `canOpenSession`: an enabled account is `ok()`; `disabledAt` set is `refuse('signIn.accountDisabled')`.
  - `SIGN_IN_REFUSALS` equals the five keys and reasons of decision 2 (pins the reasons the web table maps).

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- sign-in`. It fails: the module is missing.

- [ ] **Step 3: Implement** in `sign-in.ts`: `PROVIDERS`, `Provider`, `isProvider`, `SIGN_IN_REFUSALS`, `SignInRefusalReason`, `SignInRefusal`, `signInEmail`, `magicLinkRequest`, `CLIENT_OAUTH_FIELDS`, `canStartOAuth`, `FRESH_AGE_SECONDS`, `isFreshSession`, `canLinkProvider`, `canOpenSession`. Doc comments name the ruling or security item of each (spec, "Design"). `signInEmail` builds on `canonicalEmail`; `canOpenSession` on `isDisabled`. Export them from `index.ts`.

- [ ] **Step 4:** Run the domain tests and check they pass. Report.

### Task A2: Provider joins, provider sessions, the Lichess notice (backend-dev) - SECURITY

**Files:**
- Modify: `packages/domain/src/sign-in.ts`, `src/sign-in.test.ts`, `src/index.ts`

- [ ] **Step 1: Write the tests.** An `account(over)` helper as in `implicit-join.test.ts:6-19`, and `email(over)` and `settings(over)` builders for the two `ProviderJoin` shapes.
  - **`via: 'email'`**, the eight cases of `apps/web/src/server/implicit-join.test.ts`, with domain reasons:
    - verified Google and an enabled account: `ok({ kind: 'proveEmail', accountId: 'a1' })`;
    - Lichess: `refuse('signIn.lichessEmailInUse')`;
    - `github`, an undefined provider, `emailVerified: false`, `emailVerified: undefined`, no account, a disabled account: `refuse('signIn.joinRefused')`;
    - plus: `emailVerified: 'true'` (a string) is `joinRefused`; Lichess with a disabled account is `lichessEmailInUse`.
  - **`via: 'settings'`:**
    - Lichess with `linkAccountId`, `targetAccountId` and `sessionAccountId` all `'a1'`: `ok({ kind: 'link' })`;
    - Lichess with `linkAccountId: 'a2'`, with `sessionAccountId: 'a2'`, with `sessionAccountId: undefined`, and with `targetAccountId: undefined` (and the others `'a1'`): `refuse('signIn.lichessEmailInUse')`;
    - Google, and an undefined provider, with mismatched ids: `ok({ kind: 'link' })` (spec decision 9).
  - **Properties (fast-check)**, over arbitrary joins (provider from `google`, `lichess`, `github`, undefined; `emailVerified` from `true`, `false`, `'true'`, undefined; ids from a small set including undefined; account enabled, disabled or missing):
    - an `email` result is `proveEmail` iff provider is `google`, `emailVerified === true` and the account is present and enabled; its `accountId` is the account's id;
    - an `email` result is never `link`;
    - a Lichess `settings` result is `link` iff the three ids are equal and defined.
  - **`providerSessionStands`:** `('google', ['google', 'lichess'])` true; `('lichess', ['google'])` false; `('google', [])` false.
  - **`leavesLichessNotice`:** `('lichess', 'proof')` true; `('lichess', 'unlink')`, `('google', 'proof')` false.
  - **`showsLichessNotice`:** `{ noticeFor: 'a1', accountId: 'a1', linkedProviders: [] }` true; `noticeFor: 'a2'` false; `noticeFor: undefined` false; `linkedProviders: ['lichess']` false; `linkedProviders: ['google']` true.

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- sign-in`. The new cases fail.

- [ ] **Step 3: Implement** `ProviderJoin`, `JoinAllowed`, `decideProviderJoin` (with private `settingsLink` and `emailJoin`; `emailJoin` keeps `implicitJoin`'s check order: Lichess first, then provider and verification, then the account), `providerSessionStands`, `LinkEnd`, `leavesLichessNotice`, `showsLichessNotice`. Export them.

- [ ] **Step 4:** Run the domain tests and check they pass. Report.

### Task A3: The persona sign-in rules (backend-dev) - SECURITY

**Files:**
- Create: `packages/domain/src/persona-sign-in.ts`, `src/persona-sign-in.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write the tests.**
  - `personaEmail`: `' U1@MyChess.test '` gives `ok('u1@mychess.test')`; `'ruta@example.lt'`, `'u1@mychess.test.evil.lt'`, `'u1@evilmychess.test'`, `'@mychess.test'`, `'not an email'` give `refuse('testSignIn.notAPersona')`.
  - `personaSignInAvailable`: the four combinations of `{ production, switchedOn }`; only `{ production: false, switchedOn: true }` is true.
  - `PERSONA_EMAIL_DOMAIN` is `'@mychess.test'`.

- [ ] **Step 2:** Run `pnpm --filter @mychess/domain test -- persona-sign-in`. It fails.

- [ ] **Step 3: Implement** `PERSONA_EMAIL_DOMAIN`, `PERSONA_REFUSALS`, `personaEmail` (on `canonicalEmail`), `personaSignInAvailable`. Export them.

- [ ] **Step 4:** Run the domain tests and check they pass. Report. The lead commits A1 to A3.

---

## Part B: the adapter (web)

### Task B1: The refusal table (web-dev) - SECURITY

**Files:**
- Create: `apps/web/src/server/auth-refusal.ts`, `auth-refusal.test.ts`

- [ ] **Step 1: Write the tests.** For each reason, `refusalError(refusal)` has the status and `body.code` of decision 4, and `refusalCode(refusal)` the code:
  - `lichessEmailInUse` gives code `lichess_email_in_use`; `joinRefused` gives `join_refused` (the constants of `lib/sign-in-errors.ts`);
  - `sessionNotFresh` is 403 with code and message `SESSION_NOT_FRESH`;
  - `clientOAuthField` with `field: 'loginHint'` is 400 with code `unsupported_oauth_field` and message `loginHint`;
  - `{ reason: 'account.emailInvalid' }` is 400 with code and message `account.emailInvalid`.

  Read the status and body the way the feature support reads an `APIError` today (`statusCode`, `body.code`, `body.message`); if `APIError` exposes them differently in 1.7.10, stop and tell the lead.

- [ ] **Step 2:** Run `pnpm --filter @mychess/web test:component -- auth-refusal`. It fails.

- [ ] **Step 3: Implement** decision 4. Nothing imports it yet besides its test.

- [ ] **Step 4:** Run it and check it passes. Report.

### Task B2: Request and session hooks on the domain (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/server/auth.ts`, `session.ts`, `src/lib/providers.ts`, `src/app/nustatymai/providers.tsx`, `src/app/prisijungti/sign-in-form.tsx`, `src/server/provider-links.ts`
- Delete: `apps/web/src/server/session-freshness.ts`, `session-freshness.test.ts`
- Test (shape only, as the spec lists): `src/lib/providers.test.ts` (remove the `isProvider` block, :4-12; A1 holds its cases)

- [ ] **Step 1:** Run `pnpm --filter @mychess/web test:feature -- oauth magic-link session settings export test-sign-in` on the unchanged tree and note the result: the baseline every later step must match.

- [ ] **Step 2: Providers and freshness.**
  - `lib/providers.ts` as in decision 6; the importers of `Provider` and `isProvider` import from `@mychess/domain`.
  - `session.ts`: `isFreshSession(new Date(session.session.createdAt), new Date())` from `@mychess/domain`.
  - Delete `session-freshness.ts` and its test; remove the `isProvider` block from `providers.test.ts`.

- [ ] **Step 3: The request hooks in `auth.ts`.**
  - `canonicalMagicLinkBody`: on `/sign-in/magic-link`, `magicLinkRequest(body.email)`; a refusal throws `refusalError(result.refusal)`; success returns `{ context: { body: { ...body, ...result.value } } }`.
  - `refuseClientOAuthFields`: on an OAuth start path, `canStartOAuth(fieldsOf(ctx.body))`, where `fieldsOf` is the `z.looseObject({})` parse of today (:102-105) returning the keys; a refusal throws `refusalError`.
  - `refuseStaleLink`: on `/link-social` with a session, `canLinkProvider(new Date(current.session.createdAt), new Date())`; a refusal throws `refusalError`.
  - `user.create.before`: `signInEmail(account.email)`; a refusal throws `refusalError`.
  - `session.create.before`: reads the account; `account === undefined || canOpenSession(account).ok`. Keep today's comment on the account being created in this request.
  - `freshAge: FRESH_AGE_SECONDS` from `@mychess/domain`.
  - Delete `canonicalOrRefuse`, `CLIENT_OAUTH_FIELDS`, `clientOAuthField`, `isNotDisabled`; drop the `canonicalEmail` and `isDisabled` imports.

- [ ] **Step 4:** Run `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`. Everything passes unchanged, in particular:
  - `magic-link.test.ts` :54, :65, :72, :94, :107;
  - `oauth.test.ts` :149, :315;
  - `settings.test.ts` :340, :352, :366;
  - `export.test.ts` :104, :116, :178;
  - `session.test.ts` :56; `session-helpers.test.ts` :65;
  - `oauth.test.ts` :190 (a disabled account opens no session);
  - `test-sign-in.test.ts` :177.

  Report. The lead commits B1 and B2.

### Task B3: Provider joins, provider sessions and the Lichess notice on the domain (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/server/auth.ts`, `provider-session.ts`, `lichess-unlinked.ts`
- Delete: `apps/web/src/server/implicit-join.ts`, `implicit-join.test.ts` (its cases are in A2)

- [ ] **Step 1: `validateUserInfo`.**
  - Unchanged: a `create-user` action returns before anything is read; `getOAuthState()` gives `link`.
  - With `link`: `decideProviderJoin({ via: 'settings', provider: source.oauth?.providerId, linkAccountId: link.userId, targetAccountId: idOf(user), sessionAccountId: current?.user.id })`, reading the session with `getAuthoritativeSessionFromCtx(ctx)` only when the provider is Lichess, as today (`linkFromSettings` :164-165 reads it after the provider check). If keeping that order would push the function over complexity 10, read it always and tell the reviewer; it is a read, not a decision.
  - Without `link`: `decideProviderJoin({ via: 'email', provider, emailVerified: user.emailVerified, account })`, with `account` from `findAccountById` when `idOf(user)` is a string, as today.
  - A refusal answers `{ error: refusalCode(result.refusal) }`; `proveEmail` calls `revokeUnprovenAccountAccess(ctx, accountId)` and answers `undefined`; `link` answers `undefined`.
  - `idOf(user)` is `typeof user.id === 'string' ? user.id : undefined`.
  - Delete `linkFromSettings`, `joinByEmail`, the `LICHESS` constant and the `implicitJoin` import. Keep the doc comments' content (R-69, R-83, R-87, why a signed-in plain sign-in is an implicit join), moved to the new functions.
- [ ] **Step 2: `provider-session.ts`.** The decision becomes `providerSessionStands(provider, links.map((link) => link.providerId))`; path, parsing, deletion and the `APIError` stay.
- [ ] **Step 3: `lichess-unlinked.ts`.** `noteLichessUnlinked` leaves the cookie when `leavesLichessNotice(row.data.providerId, PROOF_PATHS.has(ctx.path) ? 'proof' : 'unlink')`; `showLichessUnlinked` returns `showsLichessNotice({ noticeFor: note, accountId, linkedProviders: links.map((l) => l.provider) })`. Exports and signatures unchanged.
- [ ] **Step 4:** Delete `implicit-join.ts` and its test.
- [ ] **Step 5:** Run `pnpm --filter @mychess/web test:component` and `pnpm --filter @mychess/web test:feature`. Everything passes unchanged, in particular:
  - `oauth.test.ts`: :116, :130, :140, :174, :190, :210, :222, :240, :260, :341, :356, :366, :374, :395, :404, :418;
  - `oauth-link-race.test.ts`: :109, :152, :181 (#272);
  - `settings.test.ts`: :387, :427, :433, :446, :451, :461 (R-90).

  Report.

### Task B4: The persona sign-in on the domain (web-dev) - SECURITY

**Files:**
- Modify: `apps/web/src/server/test-sign-in.ts`

- [ ] **Step 1:** `personaEmail` (the zod schema, same name) transforms with the domain's `personaEmail(raw)`: success returns the value; a refusal adds an issue whose message is the refusal's reason (`testSignIn.notAPersona`, as today). Delete `PERSONA_DOMAIN` and `NOT_A_PERSONA`.
- [ ] **Step 2:** `enabled(env)` returns `personaSignInAvailable({ production: env.MYCHESS_ENV === 'production', switchedOn: env.MYCHESS_TEST_SIGNIN })`. The secret comparison, the route answers and the plugin stay.
- [ ] **Step 3:** Run `pnpm --filter @mychess/web test:component -- test-sign-in` and `pnpm --filter @mychess/web test:feature -- test-sign-in`. Everything passes unchanged: unit :57, :68, :73, :87, :120, :129, :144; feature :85 to :223.

  Check the spec's greps (Done means). Report. The lead commits B3 and B4.

---

## Part C: close

### Task C1: Security review (security-reviewer) - SECURITY

- [ ] Review the A1 to B4 diff. Check:
  - every guard that `auth.ts` had still runs on the same Better Auth path and in the same order (`refuseClientOAuthFields`, then `refuseStaleLink`, then the magic-link body);
  - `decideProviderJoin` is deny-by-default for `via: 'email'` (A1): only verified Google onto an enabled account;
  - the Lichess settings link still needs the link's, the target's and the session's account to be one;
  - `revokeUnprovenAccountAccess` is still called for every allowed implicit join, and nothing pre-decides "already proven" outside its lock;
  - every refusal reaches the client with the same status and code as before (`auth-refusal.ts` against `lib/sign-in-errors.ts`);
  - the persona sign-in still refuses production in the domain, in the plugin's endpoint, in the route and at env parse.

  Report findings to the lead.

### Task C2: Close (lead, architect)

- [ ] The lead runs `node quality/gate.mjs check` on the final tree; CI's mutation run on `sign-in.ts` and `persona-sign-in.ts` must be green.
- [ ] The architect runs `mp-code-review` on the diff since the commit before A1 and checks the spec's "Done means".
- [ ] The lead takes the CONTEXT.md wording point (spec, "Product questions") to the owner.
- [ ] Close #265 with the commit range and the CI result.

---

## Self-review against the spec

| Spec item | Task |
| --- | --- |
| Decision 1: two pure domain modules | A1, A2, A3 |
| Decision 2: what stays in the adapter | B2, B3, B4 |
| Decision 3: one refusal set, one exhaustive wire table | A1, B1 |
| Decision 4: providers in the domain | A1, B2 |
| Decision 5: freshness in the domain | A1, B2 |
| Decision 6: the proof stays Better Auth's | B3, C1 |
| Decision 7: time is an input | A1, B2 |
| Decision 8: the provider's claim judged in the domain | A2, B3 |
| Decision 9: settings link of other providers unchanged | A2, C1 |
| Decision 10: the persona switch | A3, B4 |
| Decision 11: domain language | C2 |
| Tests that change shape | B2 (`providers.test.ts`, `session-freshness.test.ts`), B3 (`implicit-join.test.ts`) |
| Feature tests unchanged | B2, B3, B4 step "Run" |
| Done means | C2 |

## Spec gaps for the owner

None that change behaviour. One wording point only: CONTEXT.md's "Provider link" says "never by matching emails (R-69)", while R-87 lets a verified Google email join. If a task finds that a wire code, status, redirect or check order cannot be kept exactly, the developer stops and the lead decides with the owner.
