# Sign-in policy out of the auth adapter: design

Issue #265 (from the S1 architecture review, #251, candidate 1). Folds in the owner's comment on #265: the implicit-join decision (`apps/web/src/server/implicit-join.ts`, R-87, security A1 deny-by-default) moves into the domain with the other sign-in rules (security review of #270, advisory 3).

A deepening refactor with no product change: behaviour, rulings, wire codes, redirects and every existing feature test stay as they are. Better Auth stays (ADR 0010). No schema change, no migration, no catalogue change.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-69 | One account per canonical email. A verified Google email joins the existing account. Lichess is linked only from settings while signed in, never merged by email |
| R-83 | A first Lichess sign-in whose email already belongs to an account is refused with its own code (`lichess_email_in_use`); otherwise it creates the account with that email |
| R-84 | Linking Google or Lichess from settings needs a session started within the last day, as unlinking does (Better Auth's `freshAge`, same code `SESSION_NOT_FRESH`) |
| R-87 | A verified Google email proves the mailbox like a magic link: an unproven account (created by Lichess) loses its unproven access (provider links and sessions), then Google joins it |
| R-90 | When a proof of the email ends a Lichess link, settings tells that account Lichess was disconnected for security, until Lichess is connected again |
| R-73, R-93 | The persona sign-in exists only when switched on and never in production; it accepts only `@mychess.test` emails and needs the shared secret |
| R-80 | A disabled account opens no session (security item 8); sessions live in the database |
| R-81 | Only Google or Lichess prefill the display name: a magic-link request cannot name the account |
| R-95 | The data export uses the same freshness as linking (R-84) |

Also kept, from the S1 security checklist (#233) and the #270 review: item 6 (canonical email, look-alikes refused), item 7 (the client cannot choose OAuth scopes, provider parameters, login hint or id token), item 8 (disabled opens no session), A1 (an implicit join is denied unless allowed), and #272 (a session a provider callback opened stands only while that provider's link does).

ADR 0010 (Better Auth) and CLAUDE.md "rules live in domain objects", "refusals are values" and "parse at the edges" are the rules this refactor serves.

## The problem, in the current code

Six product and security decisions are made inside Better Auth hooks in `apps/web/src/server/`, and only the Testcontainers feature suite (`web-feature`) can test them. That suite is mutation-tested only nightly (R-92), so a weakened guard survives every per-push run.

1. **`auth.ts`:**
   - `canonicalOrRefuse` (:59-66) and `canonicalMagicLinkBody` (:84-90): the canonical email and the blank name of a magic-link request (item 6, R-81). `user.create.before` (:230-237) applies the same canonical email to every new account.
   - `CLIENT_OAUTH_FIELDS`, `clientOAuthField`, `refuseClientOAuthFields` (:94-121): the client-chosen OAuth fields (item 7).
   - `refuseStaleLink` (:133-142): a link needs a fresh session (R-84).
   - `linkFromSettings` (:159-168): the Lichess link guard (R-69, R-83).
   - `joinByEmail` (:178-195) and `validateUserInfo` (:204-212): which path a provider identity takes, and the implicit join.
   - `isNotDisabled` (:219-222): a disabled account opens no session (R-80, item 8).
2. **`implicit-join.ts`** (all): the implicit-join rule (R-69, R-83, R-87, A1). Pure, but in `apps/web`, typed on web error codes.
3. **`session-freshness.ts`** (all): `FRESH_AGE_SECONDS` and `isFreshSession` (R-84, R-95). Pure, but in `apps/web`.
4. **`provider-session.ts`** `endUnlinkedProviderSession` (:38-50): a provider session stands only while that provider's link does (#272).
5. **`lichess-unlinked.ts`** `noteLichessUnlinked` (:30-45) and `showLichessUnlinked` (:52-61): when the notice is left and when it shows (R-90).
6. **`test-sign-in.ts`** `personaEmail` (:25-30) and `enabled` (:35-36): the persona email and when the persona sign-in exists (R-73, R-93).
7. **`lib/providers.ts`**: `PROVIDERS`, `Provider` and `isProvider` (R-68) live in web, so a domain rule cannot name a provider without repeating the list.

## Lead decisions

None of these is a product rule.

1. **Two new pure domain modules.** `packages/domain/src/sign-in.ts` holds the account sign-in rules; `packages/domain/src/persona-sign-in.ts` holds the persona sign-in rules (R-73, R-93). They import only `zod`, `@mychess/chess` (`Result`) and domain siblings (`account.ts`). They know nothing of Better Auth: no paths, no request bodies, no cookies, no headers, no `APIError`.
2. **What stays in the adapter (`apps/web/src/server/`)**, because it is Better Auth or HTTP mechanism, not a rule:
   - which Better Auth path is which (`/sign-in/magic-link`, `/sign-in/social`, `/link-social`, `/callback/:id`, `/magic-link/verify`), reading the session, the OAuth state and the request body, and merging a hook's body;
   - turning a refusal into an `APIError`, a `{ error }` answer or a `false` (decision 4);
   - `revokeUnprovenAccountAccess` (decision 6), deleting a session, setting and reading the R-90 cookie;
   - "an account the connection cannot see yet is being created in this request" (`isNotDisabled`, :219-222): a database visibility fact, so the adapter allows a session for it and asks the domain only about an account it found;
   - the timing-safe secret comparison of the persona route (`node:crypto`);
   - the sign-up locale (R-85, `sign-up-locale.ts`): not one of #265's decisions, unchanged.
3. **One refusal set.** `SIGN_IN_REFUSALS` in `sign-in.ts`:

   | Key | Reason | Today's wire answer (kept) |
   | --- | --- | --- |
   | `lichessEmailInUse` | `signIn.lichessEmailInUse` | `{ error: 'lichess_email_in_use' }` from `validateUserInfo` |
   | `joinRefused` | `signIn.joinRefused` | `{ error: 'join_refused' }` from `validateUserInfo` |
   | `sessionNotFresh` | `signIn.sessionNotFresh` | `APIError('FORBIDDEN', { code: 'SESSION_NOT_FRESH', message: 'SESSION_NOT_FRESH' })` |
   | `clientOAuthField` | `signIn.clientOAuthField`, with `field` | `APIError('BAD_REQUEST', { code: 'unsupported_oauth_field', message: field })` |
   | `accountDisabled` | `signIn.accountDisabled` | `false` from `session.create.before` (Better Auth answers `unable_to_create_session`) |

   An invalid email keeps the existing `ACCOUNT_REFUSALS.emailInvalid` (`account.emailInvalid`), answered as today with `APIError('BAD_REQUEST', { code, message })`. The persona refusal keeps `testSignIn.notAPersona`.

   The wire codes do not change: the sign-in page, settings and the export route translate them through `lib/sign-in-errors.ts` exactly as now. The domain reasons never reach the UI directly, so no catalogue entry is added. The adapter maps every reason in one exhaustive table typed `Record<SignInRefusalReason, ...>` (`apps/web/src/server/auth-refusal.ts`), so a new reason fails typecheck until it has a wire answer.
4. **Providers move to the domain.** `PROVIDERS`, `Provider` and `isProvider` move from `apps/web/src/lib/providers.ts` to `sign-in.ts`. `lib/providers.ts` keeps only `offeredProviders` (a UI choice that depends on server config), built on the domain's `PROVIDERS`. Every importer of `Provider` and `isProvider` imports from `@mychess/domain`; nothing is re-exported (replace, don't layer). Client components already import `@mychess/domain`.
5. **Freshness moves to the domain.** `FRESH_AGE_SECONDS` and `isFreshSession` move to `sign-in.ts` with their names, and `isFreshSession` takes `now` explicitly (no default). `auth.ts` keeps `freshAge: FRESH_AGE_SECONDS`, so Better Auth's unlink check and ours stay one number. `session.ts` `hasFreshSession` (R-95) imports it from the domain.
6. **The proof stays Better Auth's.** An allowed implicit Google join returns `proveEmail` with the account id, as today, and the adapter calls `revokeUnprovenAccountAccess` for it every time. Better Auth 1.7.10 re-reads `emailVerified` under its own cleanup lock and does nothing for a proven account (`better-auth/dist/db/revoke-unproven-account-access.mjs:33-56`); the #272 race tests rely on that lock. The domain does not pre-decide "already proven, skip the proof", because that read would be outside the lock.
7. **Time is an input.** Every domain function that needs the time takes `now`. The adapter passes `new Date()`.
8. **The provider's claim is judged in the domain.** `emailVerified` reaches the domain as `unknown`, as `implicitJoin` takes it today; only `true` counts. The provider id reaches it as `string | undefined`. An identity's account id reaches it as `string | undefined` (the adapter narrows `user.id` with `typeof`, as `joinByEmail` does today).
9. **Kept as it is (not widened):** a settings link of a provider other than Lichess passes the domain, because Better Auth itself joins it to the session's account only (`linkFromSettings` :164). Deny-by-default (A1) covers the implicit join, as today. If the security reviewer wants the settings link deny-by-default too, that is a behaviour change and a new issue.
10. **The persona switch.** `persona-sign-in.ts` decides availability from `{ production, switchedOn }`. The adapter derives `production` from `MYCHESS_ENV === 'production'`. The env schema's own refusal of the switch in production (`env.ts`) stays: it is configuration parsing, a second line.
11. **Domain language.** The code words are the CONTEXT.md terms: Account, Provider link, Profile. `docs/CONTEXT.md`'s "Provider link" entry says "never by matching emails (R-69)", which predates R-87's Google join. This refactor does not edit CONTEXT.md; the lead raises the wording with the owner (see the end).

## Design

### Domain (`packages/domain`)

**`src/sign-in.ts` (new):**

- **Providers (R-68):** `PROVIDERS = ['google', 'lichess'] as const`, `type Provider`, `isProvider(value: string): value is Provider`.
- **Refusals:** `SIGN_IN_REFUSALS` (decision 3), `type SignInRefusalReason`, and
  ```ts
  export type SignInRefusal =
    | { readonly reason: Exclude<SignInRefusalReason, 'signIn.clientOAuthField'> }
    | { readonly reason: 'signIn.clientOAuthField'; readonly field: string };
  ```
- **The email a sign-in is keyed by (item 6, R-81):**
  - `signInEmail(raw: unknown): Result<string, AccountRefusal>`: `canonicalEmail` for a string, `account.emailInvalid` for anything else. Used for the magic-link request and for every new account.
  - `magicLinkRequest(raw: unknown): Result<{ email: string; name: '' }, AccountRefusal>`: the canonical email, and a blank name, because only Google or Lichess prefill the display name (R-81).
- **Starting OAuth (item 7):**
  - `CLIENT_OAUTH_FIELDS = ['scopes', 'additionalParams', 'loginHint', 'idToken'] as const`;
  - `canStartOAuth(requestFields: readonly string[]): Result<undefined, SignInRefusal>`: refuses with `clientOAuthField` and the first listed field present, in `CLIENT_OAUTH_FIELDS` order (today's `find` order).
- **Fresh sessions (R-84, R-95):**
  - `FRESH_AGE_SECONDS = 86_400`;
  - `isFreshSession(createdAt: Date, now: Date): boolean`, strictly less than a day;
  - `canLinkProvider(sessionCreatedAt: Date, now: Date): Result<undefined, SignInRefusal>`: `sessionNotFresh` unless fresh. A request with no session never reaches it (Better Auth refuses it, as today).
- **A provider identity joining an existing account (R-69, R-83, R-87, A1):**
  ```ts
  export type ProviderJoin =
    | {
        readonly via: 'settings';
        readonly provider: string | undefined;
        /** The account the OAuth state's `link` names. */
        readonly linkAccountId: string;
        /** The account Better Auth is about to link the identity to. */
        readonly targetAccountId: string | undefined;
        /** The account of the request's session, if any. */
        readonly sessionAccountId: string | undefined;
      }
    | {
        readonly via: 'email';
        readonly provider: string | undefined;
        /** What the provider says of the email; only `true` counts. */
        readonly emailVerified: unknown;
        /** The account with that email, as the database holds it. */
        readonly account: Account | undefined;
      };

  export type JoinAllowed =
    | { readonly kind: 'link' }
    | { readonly kind: 'proveEmail'; readonly accountId: string };

  export function decideProviderJoin(join: ProviderJoin): Result<JoinAllowed, SignInRefusal>;
  ```
  - `via: 'settings'`: Lichess is allowed (`link`) only when `linkAccountId === targetAccountId` and `sessionAccountId === targetAccountId`, with `targetAccountId` defined; otherwise `lichessEmailInUse`. Any other provider is `link` (decision 9).
  - `via: 'email'` (today's `implicitJoin`, unchanged): Lichess is `lichessEmailInUse`; a provider other than Google, or an `emailVerified` that is not `true`, is `joinRefused`; a missing or disabled account is `joinRefused`; otherwise `proveEmail` with the account's id.
  - Two private functions (`settingsLink`, `emailJoin`) keep each under complexity 10.
- **Opening a session (R-80, item 8):** `canOpenSession(account: Account): Result<undefined, SignInRefusal>`: `accountDisabled` when `isDisabled(account)`.
- **A provider callback's session (#272):** `providerSessionStands(provider: string, linkedProviders: readonly string[]): boolean`: true only when the provider is among the account's provider links.
- **The Lichess-disconnected notice (R-90):**
  - `type LinkEnd = 'proof' | 'unlink'`;
  - `leavesLichessNotice(provider: string, endedBy: LinkEnd): boolean`: true only for a Lichess link ended by a proof of the email;
  - `showsLichessNotice({ noticeFor, accountId, linkedProviders }): boolean`: true only when the browser's notice names this account and Lichess is not linked again. `noticeFor` is `string | undefined`.

**`src/persona-sign-in.ts` (new, R-73, R-93):**

- `PERSONA_EMAIL_DOMAIN = '@mychess.test'`;
- `PERSONA_REFUSALS = { notAPersona: 'testSignIn.notAPersona' } as const`;
- `personaEmail(raw: string): Result<string, { reason: 'testSignIn.notAPersona' }>`: the canonical email when it ends with the persona domain; refused otherwise, invalid emails included;
- `personaSignInAvailable({ production, switchedOn }): boolean`: `!production && switchedOn`.

**`src/index.ts`:** exports the above.

### Web (`apps/web`)

- **`src/server/auth-refusal.ts` (new):** the wire answers of decision 3.
  - `refusalError(refusal: SignInRefusal | AccountRefusal): APIError` for the request hooks (status and code per the table; `clientOAuthField` puts the field in `message`);
  - `refusalCode(refusal: SignInRefusal): string` for `validateUserInfo` (`lichess_email_in_use`, `join_refused`), reading the existing constants in `lib/sign-in-errors.ts`.
  - The table is a `Record<SignInRefusalReason, ...>`, so it is total by type.
- **`src/server/auth.ts`:** every hook becomes "read Better Auth's input, call the domain, map the refusal":
  - `canonicalMagicLinkBody`: `magicLinkRequest(body.email)`; refusal to `refusalError`; success merged into the body as today (`{ ...body, email, name: '' }`).
  - `user.create.before`: `signInEmail(account.email)`; locale unchanged.
  - `refuseClientOAuthFields`: the path check stays; `canStartOAuth(Object.keys(body))`.
  - `refuseStaleLink`: the path and no-session checks stay; `canLinkProvider(new Date(current.session.createdAt), new Date())`.
  - `validateUserInfo`: builds a `ProviderJoin` (`via: 'settings'` when the OAuth state has `link`, `via: 'email'` otherwise; a `create-user` action still passes before anything is read), calls `decideProviderJoin`, answers `{ error: refusalCode(...) }` for a refusal, calls `revokeUnprovenAccountAccess` for `proveEmail`, and nothing for `link`.
  - `session.create.before`: `account === undefined || canOpenSession(account).ok`.
  - `CLIENT_OAUTH_FIELDS`, `clientOAuthField`, `canonicalOrRefuse`, `isNotDisabled`, `linkFromSettings` and `joinByEmail` go; the `LICHESS` constant goes.
- **`src/server/provider-session.ts`:** keeps path, parsing, deletion and the throw; the decision is `providerSessionStands(provider, links.map((l) => l.providerId))`.
- **`src/server/lichess-unlinked.ts`:** keeps its exports and signatures (`settings.test.ts` imports `showLichessUnlinked`). `PROOF_PATHS` maps the path to `endedBy: 'proof'` (anything else is `'unlink'`); the decisions are `leavesLichessNotice` and `showsLichessNotice`.
- **`src/server/test-sign-in.ts`:** keeps its exports, its zod body schema and its route answers. The schema's transform calls `personaEmail` and adds the refusal's reason as the issue message (today's `NOT_A_PERSONA` key); `enabled(env)` becomes `personaSignInAvailable({ production: env.MYCHESS_ENV === 'production', switchedOn: env.MYCHESS_TEST_SIGNIN })`.
- **`src/server/session.ts`:** imports `isFreshSession` from the domain and passes `new Date()`.
- **`src/lib/providers.ts`:** only `offeredProviders`, on the domain's `PROVIDERS`.
- **Deleted:** `src/server/implicit-join.ts` and its test, `src/server/session-freshness.ts` and its test.
- **Importers moved to `@mychess/domain`** for `Provider`/`isProvider`: `app/nustatymai/providers.tsx`, `app/prisijungti/sign-in-form.tsx`, `server/provider-links.ts`, `server/lichess-unlinked.ts`, `server/auth.ts`.

### Not in scope

- The sign-up locale (R-85): unchanged.
- `session.ts` `getAccount` reading a disabled account as signed out: it already decides with the domain's `isDisabled`; unchanged.
- Better Auth configuration (disabled paths, rate limits, origin checks, `accountLinking`, cookies): configuration, not a decision moved here.
- Any change to the settings-link rule for providers other than Lichess (decision 9).

## Testing

### New domain unit tests (exhaustive, no database)

- **`packages/domain/src/sign-in.test.ts`:**
  - `isProvider`: the cases of `lib/providers.test.ts:4-12` (`google`, `lichess` known; `credential`, `Google`, `''` not).
  - `signInEmail` and `magicLinkRequest`: `' Ruta@Example.lt '`, `'RUTA@EXAMPLE.LT'` and the full-width form give `ruta@example.lt`; a Cyrillic look-alike, `''`, `undefined`, `1` and `null` are `account.emailInvalid`; `magicLinkRequest` always gives `name: ''`.
  - `canStartOAuth`: `[]` and unrelated fields (`provider`, `callbackURL`, `disableRedirect`) pass; each of the four fields alone is refused naming it; two together name the first in list order; `'Scopes'` (other case) passes, as today.
  - `isFreshSession` and `canLinkProvider`: the table of `session-freshness.test.ts` (0 h, 23 h fresh; 24 h, 25 h not), plus one millisecond under a day fresh and a `createdAt` after `now` fresh; `FRESH_AGE_SECONDS` is `86_400`.
  - `decideProviderJoin`, `via: 'email'`: the eight cases of `implicit-join.test.ts`, with the reasons as domain keys, plus a disabled account with a Lichess identity (`lichessEmailInUse` wins, as today's order).
  - `decideProviderJoin`, `via: 'settings'`: Lichess with link, target and session all the same account is `link`; a different link account, a different session account, no session, and an undefined target are each `lichessEmailInUse`; Google and an undefined provider are `link` whatever the ids.
  - **Property (fast-check):** over random `ProviderJoin` values, a `via: 'email'` result is `proveEmail` only for Google with `emailVerified === true` and an enabled account, and its `accountId` is that account's; a Lichess result of either path is `link` only when all three ids are equal. This pins deny-by-default.
  - `canOpenSession`: enabled is ok; disabled is `accountDisabled`.
  - `providerSessionStands`: present, absent, another provider only, empty list.
  - `leavesLichessNotice`: Lichess by proof only; Google by proof and Lichess by unlink are false.
  - `showsLichessNotice`: the four cases of the settings feature tests (`settings.test.ts:427-459`) as values: this account and no Lichess link; another account; no notice; Lichess linked again.
- **`packages/domain/src/persona-sign-in.test.ts`:** the email cases of `test-sign-in.test.ts:87-118` that reach the email (another domain, `u1@mychess.test.evil.lt`, `u1@evilmychess.test`, `@mychess.test`, `not an email`) are refused; `' U1@MyChess.test '` gives `u1@mychess.test`; availability over the four `{ production, switchedOn }` combinations is true only for not production and switched on.

### New web unit test

- **`apps/web/src/server/auth-refusal.test.ts`:** each reason maps to the status and code of decision 3's table; `clientOAuthField` carries its field as the message; `account.emailInvalid` keeps code and message.

### Tests that change shape, not meaning

- `apps/web/src/server/implicit-join.test.ts`: deleted; its eight cases move to `sign-in.test.ts` (`via: 'email'`), the codes rewritten as domain reasons.
- `apps/web/src/server/session-freshness.test.ts`: deleted; its cases move to `sign-in.test.ts`.
- `apps/web/src/lib/providers.test.ts`: the `isProvider` block (:4-12) moves to `sign-in.test.ts`; the `offeredProviders` block stays byte for byte.

Every other test stays as it is, byte for byte.

### Feature tests that must pass unchanged (`web-feature`, Testcontainers)

The whole `web-feature` project passes unchanged. These are the ones that exercise the moved decisions:

- **`test/feature/oauth.test.ts`** (all):
  - Google: :83 no Google without credentials (A7); :96 new account with the Google name prefilled; :107 returning identity; :116 joins the account with the same verified email (R-69); :130 unverified email with an account, no link; :140 unverified email with no account, nothing created; :149 no sign-in with a client-posted id token.
  - Google proving the email of an account Lichess created: :174 ends the Lichess link and its sessions, proves the email, lets Google in (R-87); :190 changes nothing of a disabled account, opens no session (R-80); :210 leaves Lichess no way back by email; :222 keeps the Lichess link of an already proven account; :240 Google linked from settings leaves the account alone; :260 no second Lichess identity by email (R-69).
  - The OAuth state (item 7): :279, :293, :301.
  - The sign-in and link requests: :315 refuse each client-chosen field on sign-in and link (item 7).
  - Lichess: :341 new account with the Lichess email (R-83); :356 never merges by email, own code; :366 refuses a sign-in (not a link) by email even while signed in (R-69); :374 links from settings with either email; :395 signs in to the linked account; :404 after its Lichess email changed; :418 loses link and sessions on a magic-link proof.
  - A new account from a provider: :437, :452.
- **`test/feature/oauth-link-race.test.ts`** (all, #272): :109 no session when a proof ends the Lichess link mid-callback; :152 no session though the other link stands; :181 signs in while its link stands.
- **`test/feature/magic-link.test.ts`** (all): :27, :54 look-alike variants into one account (item 6), :65, :72, :94 Cyrillic look-alike refused with no mail, token or account, :107 the request cannot name the account (R-81), :120, :130, :148, :166, :175, :192, :204, :214, :227, :241.
- **`test/feature/session.test.ts`** (all, R-80): :30, :38, :47, :56 disabled ends sessions and opens no new one (item 8).
- **`test/feature/session-helpers.test.ts`** (all): :65 a disabled account reads as signed out.
- **`test/feature/settings.test.ts`**: :340 no unlink from a stale session; :352 no link start from a stale session (R-84); :366 a link from a fresh session; :378; :387 a link another account holds; the Lichess-disconnected notice :427, :433, :446, :451, :461 (R-90).
- **`test/feature/export.test.ts`**: :104 refuses a session more than a day old; :116 downloads for a fresh one (R-95); :178 disabled answers 401.
- **`test/feature/test-sign-in.test.ts`** (all, R-73, R-93): :85, :101, :111, :123, :139, :149, :156, :165, :177 disabled persona gets 403 and no session; :199, :211, :223.
- **`test/feature/error-redirect.test.ts`**, **`disabled-endpoints.test.ts`**, **`rate-limit.test.ts`**, **`onboarding.test.ts`**: all, unchanged (they run through `auth.ts`).

And these web unit tests, unchanged: `src/server/test-sign-in.test.ts` (all, including :87 the 403 table and :120 disabled), `src/server/sign-up-locale.test.ts`, `src/server/oauth/google.test.ts`, `src/server/oauth/lichess.test.ts`, `src/server/env.test.ts`, `src/app/nustatymai/page.test.tsx`, `src/app/nustatymai/lichess-unlinked-notice.test.tsx`.

## Done means

- Every decision listed under "The problem" is made by a function in `packages/domain/src/sign-in.ts` or `persona-sign-in.ts`, with the unit tests above. None needs a database or Better Auth to test.
- `auth.ts`, `provider-session.ts`, `lichess-unlinked.ts` and `test-sign-in.ts` only read Better Auth or HTTP input, call the domain and map its answer. A grep finds:
  - no `'lichess'` or `'google'` literal in `apps/web/src/server/auth.ts` or `provider-session.ts`;
  - no `isDisabled` import in `auth.ts`;
  - no `CLIENT_OAUTH_FIELDS` or `@mychess.test` outside `packages/domain`.
- `implicit-join.ts` and `session-freshness.ts` are gone; `Provider` and `isProvider` come only from `@mychess/domain`.
- Every wire code, status and redirect is the same: the whole `web-feature` project passes unchanged. Only the tests listed under "Tests that change shape" change.
- Mutation testing in CI is green on `sign-in.ts` and `persona-sign-in.ts` (they are now mutation-tested on every push, not only nightly through R-92).
- The gate is green.
- `security-reviewer` signs off: the sign-in guards moved.
- #265 closes.

## Product questions

None that the rulings leave open: this changes no behaviour. One wording point for the lead to take to the owner (no code depends on it): `docs/CONTEXT.md` defines a Provider link as created "never by matching emails (R-69)", but R-87 lets a verified Google email join the account with that email. The code follows R-87; the glossary entry could say "Lichess never by matching emails; Google only with a verified email (R-87)".
