# S1 Accounts: design

Issue #251 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S1.
Brainstormed with the owner on 2026-10-16.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-1 | Lithuanian is the default locale, English the second; the account stores its choice |
| R-26, R-68 | Sign-in by email magic link, Google, and Lichess (OAuth with PKCE); Lichess sign-in also links the Lichess account. Chess.com is never a sign-in method |
| R-69 | One account per canonical email; a verified Google email joins the existing account; Lichess is linked only from settings while signed in, never merged by email |
| R-3, R-70 | Every account has the free entitlement; limits are enforced in the domain (coach: 30 linked players, 10 groups), used from S4 |
| R-72 | Admin is a flag set only by a CLI script |
| R-73 | Test-only sign-in on staging: a route that exists only with a staging flag, only for `@mychess.test` emails, behind a shared-secret header; a test proves production refuses it |
| R-40, R-82 | Data export (PGN and JSON) and immediate hard delete, confirmed by typing the display name, with a confirmation email afterwards |
| R-80 | Sessions last 90 days, renewed on each visit, stored in the database |
| R-83 | Lichess sign-in reads the Lichess email; an email that already has an account is refused, not merged |
| R-81 | Onboarding: display name (prefilled from Google or Lichess) and language only |
| R-27 | Email via Resend on staging and production; Mailpit locally and in E2E |
| ADR 0010 | Better Auth instead of Auth.js |

The security checklist on #233 (items 6-10) is part of this spec's acceptance.

## Design

### Domain (`packages/domain`)

- `Account`: id, canonical email, display name (the existing `displayNameSchema`), locale (`lt | en`), entitlement (`free`), `admin: boolean`, `disabledAt`, `createdAt`. Rules live here:
  - `canonicalEmail(raw)`: NFKC, trim, lowercase; refuses anything that is not a single address. One canonical email = one account.
  - `isOnboarded(account)`: has a display name.
  - `canDelete(account, typedName)`: the typed name must equal the display name.
  - `entitlementLimits(entitlement)`: `{ coachPlayers: 30, coachGroups: 10 }` for free.
- Refusals are `Result` values with catalogue keys (`account.emailInvalid`, `account.deleteNameMismatch`, and so on).

### Database (`packages/db`)

- Better Auth's tables (user, session, account, verification) are in our Drizzle schema, extended with our account fields (locale, admin, disabled, entitlement). The canonical email is unique.
- Sessions: 90 days, sliding renewal (R-80). A disabled account's sessions are deleted at once.
- Repositories: create or find an account by canonical email; update the profile; disable; hard delete in one transaction (sessions, provider accounts, verification tokens, and every row the account owns, which is just the account in S1, with the cascade extended by later slices); export data (S1: profile JSON; repertoires and training history join as S3 and S6 land).
- `pnpm --filter @mychess/db admin:grant <email>` sets the Admin flag (R-72). There is no UI for it.

### Web (`apps/web`)

- Better Auth server config in `src/server/auth.ts`:
  - **Magic link**: one-time use, 15 minutes, sent through the mail adapter.
  - **Google**: verified email only; it may join an existing account with the same canonical email.
  - **Lichess**: generic OAuth with PKCE and the `email:read` scope only (R-83). It signs in an account previously linked to that Lichess id, or creates a new account with the Lichess email. If that email already belongs to an account, the sign-in is refused with a message to sign in another way and link Lichess from settings. It never merges by email (R-69).
  - **Linking Lichess from settings**: allowed only while signed in.
- Mail adapter: Resend when `MAIL_TRANSPORT=resend`, Mailpit SMTP when `smtp`. Message text comes from the catalogues (LT and EN).
- Pages:
  - `/prisijungti`, the sign-in page: email field plus Google and Lichess buttons. Route names follow the LT locale; the EN UI uses the same routes.
  - Magic-link landing, then `/pradzia`, the onboarding page (R-81).
  - `/nustatymai`, settings: display name, language, linked providers (link or unlink Lichess and Google), data export, delete account.
  - Signed-out pages redirect to sign-in. The home page shows the account's display name.
- Test sign-in route `/api/test/sign-in` (R-73). It is mounted only when `MYCHESS_TEST_SIGNIN=1` is set and the environment is not production. It accepts `@mychess.test` only and needs the `x-test-secret` header. A unit test and a feature test prove that a production build returns 404.
- Locale: the account's locale wins over the cookie once the player is signed in.

## Testing

- Domain unit tests: canonical email, with case and Unicode look-alikes (security item 6), onboarding, the delete check and the limits.
- Feature tests (Testcontainers):
  - sign-in creates exactly one account per canonical email;
  - Google joins an existing account only with a verified email;
  - Lichess never merges by email;
  - a session expires after 90 days and is renewed by use;
  - a disabled account loses its session;
  - delete removes every row;
  - the export contains only the requester's data;
  - the test route is refused without the flag, the secret or the domain.
- E2E (Playwright and Mailpit): the magic-link round trip in LT and EN at phone and desktop width; onboarding; settings changes; delete. Google and Lichess run through mocked OAuth providers in feature tests only; E2E never calls real providers.
- security-reviewer reviews the whole slice against checklist items 6-10.

## Done means

- Each persona can sign in by magic link locally; the E2E tests pass in CI with Mailpit.
- Case and Unicode email variants never create a second account (tested).
- The test sign-in route is proven absent in production (tested).
- Delete leaves no account rows; export works.
- security-reviewer signs off; the gate and CI are green.
- Staging sign-in (Resend, Neon) works once #234 exists. Until then, S1 closes on a green local run and CI, and staging is verified under #234.
