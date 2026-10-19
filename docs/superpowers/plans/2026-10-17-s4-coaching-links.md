# S4 Coaching links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any account can switch on Coach mode, invite players by a personal or a group invite link, keep them in groups and unlink them; a player accepts an invite (through sign-in and onboarding when signed out), sees "Mano treneriai", can unlink or leave a group, and can share an own repertoire with chosen linked coaches, who see it read-only and add coach notes. A coach sees nothing of a player without an active Coach link, and nothing of a repertoire that is not shared with them.

**Architecture:** The rules are pure functions in `packages/domain` (`coach.ts`, `invite.ts`, `coach-access.ts`, later `sharing.ts`) returning `Result` refusals with catalogue keys. `packages/db` adds the tables and transactional repositories; the database itself enforces "members and shares only through an active link" with composite foreign keys onto `coach_links` that cascade on unlink, and `acceptInvite` serialises on row locks so the 30-player limit and single use hold under concurrency. `apps/web` adds the coach area `/treneris`, the invite page `/k/[token]`, the Coach mode switch and "Mano treneriai" in `/nustatymai`, and a safe return path (`?next=`) through sign-in and onboarding that accepts only invite paths. Every coach page goes through one server helper that loads the access facts, asks `canCoachSee`, and answers `notFound()` on a refusal; the queries behind it join `coach_links` again.

**Tech Stack:** Drizzle 0.45.3 on Postgres 18 (row locks, composite foreign keys), better-auth 1.7.10 (callback URLs), Next.js 16.3 App Router with server actions, next-intl 4, zod 4, vitest 4 (feature suite on Testcontainers, #266 harness), Playwright 1.64 with Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-17-s4-coaching-links-design.md`. **Issue:** #254 (epic #250). **Rulings:** R-11 to R-13, R-39, R-42, R-45, R-47, R-50, R-70, R-81, R-96, R-98 to R-100, R-102; security checklist items 1-5 on #233. **Blocked on:** Part A on nothing (S1 is done). **Part B is blocked on S3** (#253): it starts only after S3's repertoire tables, repository and board component are on `main`.

**Roles:** each task names its role. `- SECURITY` tasks go through `security-reviewer`; `- UX` tasks go through `ux-designer` and `i18n-content`. Only the lead commits. Per task: developer (test first) -> `qa` -> `architect` (`mp-code-review` on the task's diff) -> `security-reviewer` if marked -> `ux-designer` and `i18n-content` if visible -> lead commits.

**Rules for every task** (CLAUDE.md): test first; no suppression comments, no `any`, no `!`; functions small (complexity <= 10, CRAP <= 30); every user-visible string goes through `apps/web/src/i18n/messages/{lt,en}.json` (LT first); refusals are `Result` values with catalogue keys; parse every request body, form, URL param and query result with zod. A `playerId`, `coachId` or account id sent by a client is never used to decide who acts: the actor is always the session account (checklist 4). After each task run `node quality/gate.mjs check` (needs Docker). Workers report the files they changed and the commands they ran; the lead commits. Where a test below uses `!` for brevity, use a small `must(value)` helper that throws on `undefined`, and keep the assertions the same.

**Migration numbering:** Part A's migration is generated as `0002_*` (after `0001_admin_audit_append_only`). S3 is planned in parallel and also adds a migration. Never hand-rename or hand-edit a generated migration: whichever slice lands second, the lead deletes that slice's not-yet-committed migration and its snapshot, rebases on `main`, and runs `pnpm --filter @mychess/db db:generate` again so the journal stays linear. Part B's migration is generated after S3's is on `main`.

---

## Verified library API

Read from the installed packages while planning (2026-10-17). A worker who finds a difference stops and reports it to the lead.

**drizzle-orm 0.45.3** (`packages/db/node_modules/drizzle-orm`):

- Row locks: `select(...).from(t).where(...).for(strength, config?)` with `LockStrength = 'update' | 'no key update' | 'share' | 'key share'` and `LockConfig = { of?: PgTable | PgTable[] } & ({ noWait: true } | { skipLocked: true } | {})` (`pg-core/query-builders/select.d.ts:586`, `select.types.d.ts:60-72`). The clause is emitted last, after `limit`/`offset` (`pg-core/dialect.js:288-306`).
- Transactions: `db.transaction(async (tx) => ..., config?)`, `PgTransactionConfig = { isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'; accessMode?: 'read only' | 'read write'; deferrable?: boolean }` (`pg-core/session.d.ts:31-47`). `tx.rollback(): never` throws (`session.d.ts:62`). We use the default, READ COMMITTED: each statement takes a fresh snapshot, so a `count` run **after** a lock statement sees everything committed before the lock was granted. That is what makes "lock, then count" safe; never fold the count into the locking statement.
- `PgTransaction extends PgDatabase`, so `tx.$count(table, filters?)` exists and is `Promise<number>` (`pg-core/db.d.ts:69`, `pg-core/query-builders/count.d.ts`).
- `insert(t).values(...).onConflictDoNothing({ target?, where? })` (`pg-core/query-builders/insert.d.ts:138`), `.returning({ ... })`.
- Constraints: `primaryKey({ name?, columns: [a, b] })` (`pg-core/primary-keys.d.ts:4`), `foreignKey({ name?, columns, foreignColumns }).onDelete('cascade' | 'set null' | ...)` (`pg-core/foreign-keys.d.ts:22,39`), `unique(name?).on(a, b)` (`pg-core/unique-constraint.d.ts:4-16`), `uuid('id').defaultRandom()` (`pg-core/columns/uuid.d.ts:19`), `check(name, sql)` and `index(name).on(...)` as already used in `schema.ts`.
- Postgres lock semantics we rely on: `FOR NO KEY UPDATE` on the coach's `accounts` row conflicts with another `FOR NO KEY UPDATE` and with any `UPDATE` of that row, but not with the `KEY SHARE` lock a foreign-key check takes, so it serialises link-creating transactions of one coach without blocking inserts that merely reference the coach.

**better-auth 1.7.10** (`apps/web/node_modules/better-auth/dist`):

- `api/middlewares/origin-check.mjs:41-63`: on every non-GET auth request, `callbackURL`, `newUserCallbackURL` and `errorCallbackURL` in the body are checked with `isTrustedOrigin(url, { allowRelativePaths: true })`; a failure is `403 INVALID_CALLBACK_URL` (or the matching code).
- `auth/trusted-origins.mjs:62-89`: a relative URL passes only through `isSafeRelativeURL`: it must start with `/`, not `//`, contain no `\` or control characters, no encoded path separator in the path part, and resolve to the same origin. So `/k/<token>` and `/pradzia?next=%2Fk%2F<token>` pass; this is a second line of defence behind our own allowlist (Task A9).
- Errors keep our query: the magic-link verify sets `error` with `URL.searchParams.set` on the `errorCallbackURL` (`plugins/magic-link/index.mjs:157-161`), and the OAuth callback uses `appendQueryParams` (`api/routes/callback.mjs:78-83`, `oauth2/errors.mjs:34-38`), so `/prisijungti?next=...` comes back as `/prisijungti?next=...&error=...`.

**Next.js 16.3.6:** `notFound()` and `redirect()` from `next/navigation`. `forbidden()` exists but needs `experimental.authInterrupts` (default `false`), so coach refusals answer 404 through `notFound()` (decision 4).

**node:crypto:** `randomBytes(32).toString('base64url')` gives 43 characters from `[A-Za-z0-9_-]` (256 bits); `createHash('sha256').update(token, 'utf8').digest('hex')` gives 64 hex characters.

---

## Decisions taken while planning

These fill gaps the spec leaves to the lead. None of them is a product rule; the ones that might be are listed under "Spec gaps for the owner" at the end and are **not** implemented.

1. **Two locks in `acceptInvite`.** The spec says "lock the invite row and count the coach's links". Locking only the invite row serialises two accepts of the **same** invite, but two players accepting two **different** personal invites of the same coach at 29 players would both count 29 and both link. So `acceptInvite` reads the invite's coach without a lock, locks the coach's `accounts` row (`FOR NO KEY UPDATE`, the limit), then locks the invite row (`FOR UPDATE`, single use), and only then counts. `createGroup` (10-group limit), `stopCoaching` (R-100, R-109), `deleteGroup` and `createInvite` take the same coach-row lock, so "switch off" and "accept" cannot interleave either. **Lock order is always the coach account row, then that coach's invite rows** (changed during the S4 review: `stopCoaching` revokes the open invites under the coach lock); nothing that holds an invite lock waits for a coach row. `revokeInvite` takes one invite-row lock and waits on nothing else. Part B must keep this order.
2. **The database enforces "only linked".** `group_members` and (Part B) `repertoire_shares` carry `coach_id` and `player_id` and have a composite foreign key onto `coach_links (coach_id, player_id) ON DELETE CASCADE`. Unlinking is one `DELETE FROM coach_links`, and Postgres removes the coach's group memberships and shares in the same statement, so no concurrent "add member" or "share" can leave an orphan behind (the foreign-key check locks the link row). `group_members (group_id, coach_id)` also references `groups (id, coach_id)`, so a coach cannot put a player into another coach's group. Invites reference `groups (id, coach_id)` the same way. The repository still checks first, to return a refusal value instead of a constraint error.
3. **`coach_links` has the pair as its primary key** and no surrogate id; a CHECK refuses `coach_id = player_id`. `group_members` records `joined_at` (S5 needs the join date for R-16 deadlines).
4. **Coach refusals answer 404.** A coach route for an unlinked player, a foreign group or an unshared repertoire calls `notFound()`: the page is indistinguishable from one for an id that does not exist, so it reveals nothing (checklist 1-3 say "403"; 404 is stricter and needs no experimental Next flag). Server actions return a refusal value or change nothing.
5. **The raw invite token is shown once.** Only its SHA-256 hash is stored (spec), so the coach can copy the link right after creating it; the invite list then shows kind, group, state and expiry, with Revoke. To share a link again the coach creates a new invite.
6. **Token format:** 32 random bytes as base64url (43 characters). `inviteTokenSchema` in the domain checks the format at the edge; a malformed token is "not valid" without a database lookup. SHA-256 is unkeyed: a 256-bit random token cannot be brute-forced from its hash.
7. **The return path is an allowlist, not a sanitiser.** `returnPath(raw)` accepts only `/k/<token>` with a well-formed token; anything else (absolute URLs, `//host`, backslashes, encoded slashes, other paths) is `null`, and the caller falls back to its normal destination. Better Auth's own check (above) is the second line.
8. **Accepting never happens on GET.** `/k/[token]` shows a confirm screen; the accept is a server action (POST, with Next's origin check), so link scanners and prefetching cannot accept an invite.
9. **Already linked:** accepting an invite from a coach the player is already linked to succeeds without a second link (and adds the group membership if the invite names a group); it does not count against the 30-player limit. A personal invite is still marked used.
10. **Personal invites may name a group.** The spec gives `invites` a nullable group next to the kind. A group invite must name a group (CHECK); a personal invite may (the player joins that group on accepting) or may not. Only personal invites are ever "used" (CHECK).
11. **Coach area routes:** `/treneris` (players, groups, invites), `/treneris/zaidejai/[playerId]` (one player: display name, groups, unlink; Part B adds the shared repertoires), `/treneris/grupes/[groupId]` (rename, delete, members), Part B `/treneris/zaidejai/[playerId]/repertuarai/[repertoireId]`. An account without Coach mode visiting `/treneris/**` is redirected to `/nustatymai`, where the switch is. Home shows a "Coach area" link when Coach mode is on (C-M1-1: "coach area appears alongside his player area").
12. **"Mano treneriai" is a section of `/nustatymai`** with the id `treneriai`; accepting an invite redirects to `/nustatymai#treneriai`.
13. **`canCreateGroup(coach, count)`** takes the coach as well as the count, so the limit comes from the coach's entitlement (`entitlementLimits`, R-70 seam) and a non-coach is refused.
14. **Every coach page has a loader** in `apps/web/src/server/coach-pages.ts`. The feature suite drives the loaders and actions, and a guard test fails when a `page.tsx` under `src/app/treneris` has no entry in the access table (Task A15), so a new coach route cannot ship untested.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/domain/src/account.ts` | `accountSchema` gains `coachSince` |
| `packages/domain/src/coach.ts` | `COACH_REFUSALS`, `isCoach`, `canStopCoaching`, `canCreateGroup`, `canInvite`, `groupNameSchema`, `GROUP_NAME_MAX`, `GROUP_NAME_ISSUES` |
| `packages/domain/src/invite.ts` | `INVITE_KINDS`, `INVITE_STATES`, `INVITE_TTL_MS`, `INVITE_REFUSALS`, `inviteSchema`, `inviteTokenSchema`, `inviteExpiry`, `inviteState`, `canAccept` |
| `packages/domain/src/coach-access.ts` | `ACCESS_REFUSALS`, `CoachSubject`, `CoachAccessFacts`, `canCoachSee` |
| `packages/domain/src/sharing.ts` (Part B) | `SHARE_REFUSALS`, `canShare`, `coachNoteSchema` |
| `packages/db/src/schema.ts` | `accounts.coachSince`; tables `groups`, `coachLinks`, `groupMembers`, `invites`; Part B `repertoireShares`, `coachNotes` |
| `packages/db/src/invite-token.ts` | `newInviteToken`, `inviteTokenHash` |
| `packages/db/src/invites.ts` | `createInvite`, `previewInvite`, `acceptInvite`, `revokeInvite`, `coachInvites` |
| `packages/db/src/coaching.ts` | `startCoaching`, `stopCoaching`, `coachPlayers`, `coachPlayer`, `playerCoaches`, `unlink`, `coachAccessFacts` |
| `packages/db/src/groups.ts` | `createGroup`, `renameGroup`, `deleteGroup`, `addMember`, `removeMember`, `leaveGroup`, `coachGroups`, `coachGroup` |
| `packages/db/src/shares.ts` (Part B) | `shareRepertoire`, `unshareRepertoire`, `repertoireShares`, `sharedWithCoach`, `sharedRepertoireForCoach`, `upsertCoachNote`, `deleteCoachNote`, `coachNotesOn` |
| `apps/web/src/lib/routes.ts` | coach, invite and "Mano treneriai" paths |
| `apps/web/src/lib/return-path.ts` | `returnPath`, `signInPath`, `onboardingPath` |
| `apps/web/src/server/coaching.ts` | `requireCoach`, `assertCoachMaySee` |
| `apps/web/src/server/coach-pages.ts` | one loader per coach page |
| `apps/web/src/app/treneris/**` | coach area pages, components, `actions.ts` |
| `apps/web/src/app/k/[token]/` | invite page, confirm view, `actions.ts` |
| `apps/web/src/app/nustatymai/coach-mode.tsx`, `my-coaches.tsx`, `coaching-actions.ts` | Coach mode switch, "Mano treneriai" |
| `apps/web/test/feature/*.test.ts` | `return-path`, `coach-mode`, `invites`, `groups`, `my-coaches`, `coach-access`; Part B `sharing`, `coach-notes` |
| `apps/web/e2e/support/coaching.ts`, `e2e/coaching.spec.ts`, `e2e/sharing.spec.ts` | E2E |

---

# Part A: coach capability, invites, links, groups, access rule

### Task A1: Coach capability and groups in the domain (backend-dev) - SECURITY

**Files:** Create `packages/domain/src/coach.ts`, `packages/domain/src/coach.test.ts`. Modify `packages/domain/src/account.ts`, `packages/domain/src/account.test.ts`, `packages/domain/src/index.ts`.

- [ ] **Step 1: Write the failing tests** in `coach.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  COACH_REFUSALS,
  GROUP_NAME_ISSUES,
  canCreateGroup,
  canInvite,
  canStopCoaching,
  groupNameSchema,
  isCoach,
} from './coach';

const coach = { coachSince: new Date('2026-10-17T08:00:00Z'), entitlement: 'free' as const };
const notCoach = { coachSince: null, entitlement: 'free' as const };
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('isCoach', () => {
  it('is true once Coach mode was switched on (R-11, R-13)', () => {
    expect(isCoach(coach)).toBe(true);
  });
  it('is false for an account that never switched it on', () => {
    expect(isCoach(notCoach)).toBe(false);
  });
});

describe('canStopCoaching (R-100)', () => {
  it('allows switching off with no linked player', () => {
    expect(canStopCoaching(0)).toEqual(ok);
  });
  it.each([1, 30])('refuses with %i linked players', (count) => {
    expect(canStopCoaching(count)).toEqual(refused(COACH_REFUSALS.stillLinked));
  });
});

describe('canCreateGroup (R-70: 10 groups)', () => {
  it.each([0, 9])('allows a coach with %i groups', (count) => {
    expect(canCreateGroup(coach, count)).toEqual(ok);
  });
  it.each([10, 11])('refuses a coach with %i groups', (count) => {
    expect(canCreateGroup(coach, count)).toEqual(refused(COACH_REFUSALS.groupLimit));
  });
  it('refuses an account without Coach mode', () => {
    expect(canCreateGroup(notCoach, 0)).toEqual(refused(COACH_REFUSALS.notCoach));
  });
});

describe('canInvite', () => {
  it('allows a coach', () => {
    expect(canInvite(coach)).toEqual(ok);
  });
  it('refuses an account without Coach mode', () => {
    expect(canInvite(notCoach)).toEqual(refused(COACH_REFUSALS.notCoach));
  });
});

describe('groupNameSchema', () => {
  it('trims the name', () => {
    expect(groupNameSchema.parse('  Šeštadienio grupė ')).toBe('Šeštadienio grupė');
  });
  it('takes exactly 60 characters', () => {
    expect(groupNameSchema.parse('a'.repeat(60))).toHaveLength(60);
  });
  it.each([
    ['blank', '   ', GROUP_NAME_ISSUES.blank],
    ['61 characters', 'a'.repeat(61), GROUP_NAME_ISSUES.tooLong],
  ])('refuses %s', (_, raw, issue) => {
    expect(groupNameSchema.safeParse(raw).error?.issues[0]?.message).toBe(issue);
  });
});
```

In `account.test.ts`, every `account(...)` fixture gains `coachSince: null`; add one case: `accountSchema.parse` keeps a `coachSince` date and refuses a missing `coachSince`.

- [ ] **Step 2:** `pnpm --filter @mychess/domain test`. Expected: FAIL, `./coach` not found.
- [ ] **Step 3: Implement.** In `account.ts`, add to `accountSchema`, after `onboardedAt`:

```ts
  // When the account switched Coach mode on (R-11, R-13); null when off.
  coachSince: z.date().nullable(),
```

`coach.ts`:

```ts
import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { entitlementLimits, type Account } from './account';

/** Message-catalogue keys for Coach refusals; the UI translates them. */
export const COACH_REFUSALS = {
  notCoach: 'coach.notCoach',
  stillLinked: 'coach.stillLinked',
  groupLimit: 'coach.groupLimit',
  groupNotFound: 'coach.groupNotFound',
  notLinked: 'coach.notLinked',
} as const;

export interface CoachRefusal {
  readonly reason: (typeof COACH_REFUSALS)[keyof typeof COACH_REFUSALS];
}

type CoachResult = Result<undefined, CoachRefusal>;

const OK: CoachResult = { ok: true, value: undefined };
const refuse = (reason: CoachRefusal['reason']): CoachResult => ({
  ok: false,
  refusal: { reason },
});

/** What deciding a coach action needs to know about the account. */
export type CoachFacts = Pick<Account, 'coachSince' | 'entitlement'>;

/** Has the account switched Coach mode on (R-11, R-13)? */
export function isCoach(account: Pick<Account, 'coachSince'>): boolean {
  return account.coachSince !== null;
}

/** Coach mode goes off only once no player is linked (R-100). */
export function canStopCoaching(linkCount: number): CoachResult {
  return linkCount === 0 ? OK : refuse(COACH_REFUSALS.stillLinked);
}

/** A coach may have as many groups as the entitlement allows (R-70). */
export function canCreateGroup(coach: CoachFacts, groupCount: number): CoachResult {
  if (!isCoach(coach)) return refuse(COACH_REFUSALS.notCoach);
  return groupCount < entitlementLimits(coach.entitlement).coachGroups
    ? OK
    : refuse(COACH_REFUSALS.groupLimit);
}

/** Only a coach issues invites (R-12). */
export function canInvite(coach: CoachFacts): CoachResult {
  return isCoach(coach) ? OK : refuse(COACH_REFUSALS.notCoach);
}

/** The most characters a group name may have. */
export const GROUP_NAME_MAX = 60;

/** Message-catalogue keys for group name issues. */
export const GROUP_NAME_ISSUES = {
  blank: 'groupName.blank',
  tooLong: 'groupName.tooLong',
} as const;

/** A Group's name: trimmed, never blank, at most GROUP_NAME_MAX characters. */
export const groupNameSchema = z
  .string()
  .trim()
  .min(1, GROUP_NAME_ISSUES.blank)
  .max(GROUP_NAME_MAX, GROUP_NAME_ISSUES.tooLong);
```

Export all of these (and the types `CoachFacts`, `CoachRefusal`) from `index.ts`.
- [ ] **Step 4:** `pnpm --filter @mychess/domain test`. Expected: PASS. The db and web packages now fail to typecheck where an `Account` is built without `coachSince`; Task A4 and A9 fix those. Report them, do not fix outside `packages/domain`.
- [ ] **Step 5:** `node quality/gate.mjs mutation` on the changed domain files. Expected: no surviving mutant in `coach.ts`.

### Task A2: Invites in the domain (backend-dev) - SECURITY

**Files:** Create `packages/domain/src/invite.ts`, `packages/domain/src/invite.test.ts`. Modify `packages/domain/src/index.ts`.

- [ ] **Step 1: Write the failing tests** in `invite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  INVITE_REFUSALS,
  INVITE_TTL_MS,
  canAccept,
  inviteExpiry,
  inviteState,
  inviteTokenSchema,
  type Invite,
} from './invite';

const T0 = new Date('2026-10-17T08:00:00Z');
const BEFORE_EXPIRY = new Date(T0.getTime() + INVITE_TTL_MS - 1);
const AT_EXPIRY = new Date(T0.getTime() + INVITE_TTL_MS);

const invite = (over: Partial<Invite> = {}): Invite => ({
  id: '00000000-0000-4000-8000-000000000001',
  coachId: 'coach',
  kind: 'group',
  groupId: '00000000-0000-4000-8000-0000000000aa',
  expiresAt: inviteExpiry(T0),
  revokedAt: null,
  usedAt: null,
  createdAt: T0,
  ...over,
});
const coach = { id: 'coach', coachSince: T0, entitlement: 'free' as const };
const counts = { linkedPlayers: 0, alreadyLinked: false };
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('inviteExpiry (R-99)', () => {
  it('is 7 days after creation', () => {
    expect(inviteExpiry(T0)).toEqual(new Date('2026-10-24T08:00:00Z'));
  });
});

describe('inviteState', () => {
  it.each<[string, Partial<Invite>, Date, string]>([
    ['active until the last millisecond', {}, BEFORE_EXPIRY, 'active'],
    ['expired at the expiry time', {}, AT_EXPIRY, 'expired'],
    ['revoked, even before expiry', { revokedAt: T0 }, T0, 'revoked'],
    ['revoked wins over expired', { revokedAt: T0 }, AT_EXPIRY, 'revoked'],
    ['a used personal invite', { kind: 'personal', groupId: null, usedAt: T0 }, T0, 'used'],
    ['used wins over expired', { kind: 'personal', groupId: null, usedAt: T0 }, AT_EXPIRY, 'used'],
    ['revoked wins over used', { kind: 'personal', groupId: null, usedAt: T0, revokedAt: T0 }, T0, 'revoked'],
    // A group invite is multi-use (R-98): usedAt never applies to it.
    ['a group invite stays active after use', { usedAt: T0 }, T0, 'active'],
  ])('%s', (_, over, now, state) => {
    expect(inviteState(invite(over), now)).toBe(state);
  });
});

describe('canAccept', () => {
  it('accepts an active invite for a coach below the limit', () => {
    expect(canAccept(invite(), 'player', coach, counts, T0)).toEqual(ok);
  });

  it.each<[string, Partial<Invite>, Date]>([
    ['expired', {}, AT_EXPIRY],
    ['revoked', { revokedAt: T0 }, T0],
    ['used', { kind: 'personal', groupId: null, usedAt: T0 }, T0],
  ])('refuses an %s invite with the one generic reason', (_, over, now) => {
    expect(canAccept(invite(over), 'player', coach, counts, now)).toEqual(
      refused(INVITE_REFUSALS.invalid),
    );
  });

  it("refuses the coach's own invite (checklist 5)", () => {
    expect(canAccept(invite(), 'coach', coach, counts, T0)).toEqual(
      refused(INVITE_REFUSALS.ownInvite),
    );
  });

  it('refuses when the coach switched Coach mode off', () => {
    expect(
      canAccept(invite(), 'player', { ...coach, coachSince: null }, counts, T0),
    ).toEqual(refused(INVITE_REFUSALS.notCoach));
  });

  it('allows the 30th player and refuses the 31st (R-70)', () => {
    expect(canAccept(invite(), 'p', coach, { linkedPlayers: 29, alreadyLinked: false }, T0)).toEqual(ok);
    expect(canAccept(invite(), 'p', coach, { linkedPlayers: 30, alreadyLinked: false }, T0)).toEqual(
      refused(INVITE_REFUSALS.coachFull),
    );
  });

  it('lets an already linked player in at the limit: no new link is made', () => {
    expect(canAccept(invite(), 'p', coach, { linkedPlayers: 30, alreadyLinked: true }, T0)).toEqual(ok);
  });
});

describe('inviteTokenSchema', () => {
  it('takes 43 base64url characters', () => {
    expect(inviteTokenSchema.safeParse('A'.repeat(42) + '_').success).toBe(true);
  });
  it.each([['short', 'A'.repeat(42)], ['long', 'A'.repeat(44)], ['a slash', `${'A'.repeat(42)}/`], ['a plus', `${'A'.repeat(42)}+`]])(
    'refuses %s',
    (_, raw) => {
      expect(inviteTokenSchema.safeParse(raw).success).toBe(false);
    },
  );
});
```

- [ ] **Step 2:** `pnpm --filter @mychess/domain test`. Expected: FAIL, `./invite` not found.
- [ ] **Step 3: Implement** `invite.ts`:

```ts
import type { Result } from '@mychess/chess';
import { z } from 'zod';
import { entitlementLimits, type Account } from './account';
import { isCoach } from './coach';

/** A personal invite is single use; a group invite is multi-use (R-98). */
export const INVITE_KINDS = ['personal', 'group'] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export const INVITE_STATES = ['active', 'expired', 'used', 'revoked'] as const;
export type InviteState = (typeof INVITE_STATES)[number];

/** An invite is valid for 7 days (R-99). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Message-catalogue keys for invite refusals. Expired, used, revoked and
 * unknown tokens all give `invalid`, so a refusal reveals nothing more.
 */
export const INVITE_REFUSALS = {
  invalid: 'invite.invalid',
  ownInvite: 'invite.ownInvite',
  coachFull: 'invite.coachFull',
  notCoach: 'invite.notCoach',
} as const;

export interface InviteRefusal {
  readonly reason: (typeof INVITE_REFUSALS)[keyof typeof INVITE_REFUSALS];
}

/** One invite as the database hands it over (parsed at the edge); never its token. */
export const inviteSchema = z.object({
  id: z.uuid(),
  coachId: z.string().min(1),
  kind: z.enum(INVITE_KINDS),
  groupId: z.uuid().nullable(),
  expiresAt: z.date(),
  revokedAt: z.date().nullable(),
  usedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** An invite link's token: 32 random bytes, base64url (checklist 5). */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function inviteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITE_TTL_MS);
}

/** Revoked beats used beats expired; a group invite is never "used". */
export function inviteState(invite: Invite, now: Date): InviteState {
  if (invite.revokedAt !== null) return 'revoked';
  if (invite.kind === 'personal' && invite.usedAt !== null) return 'used';
  return now.getTime() < invite.expiresAt.getTime() ? 'active' : 'expired';
}

/** What accepting needs to know about the coach behind the invite. */
export type InvitingCoach = Pick<Account, 'id' | 'coachSince' | 'entitlement'>;

/** The coach's links at the moment of accepting (read under lock). */
export interface AcceptCounts {
  readonly linkedPlayers: number;
  readonly alreadyLinked: boolean;
}

const refuse = (reason: InviteRefusal['reason']): Result<undefined, InviteRefusal> => ({
  ok: false,
  refusal: { reason },
});

/**
 * May `playerId` accept `invite` now (R-12, R-70, R-98, R-99)? An already
 * linked player needs no new link, so the player limit does not apply.
 */
export function canAccept(
  invite: Invite,
  playerId: string,
  coach: InvitingCoach,
  counts: AcceptCounts,
  now: Date,
): Result<undefined, InviteRefusal> {
  if (inviteState(invite, now) !== 'active') return refuse(INVITE_REFUSALS.invalid);
  if (playerId === invite.coachId) return refuse(INVITE_REFUSALS.ownInvite);
  if (!isCoach(coach)) return refuse(INVITE_REFUSALS.notCoach);
  if (counts.alreadyLinked) return { ok: true, value: undefined };
  return counts.linkedPlayers < entitlementLimits(coach.entitlement).coachPlayers
    ? { ok: true, value: undefined }
    : refuse(INVITE_REFUSALS.coachFull);
}
```

Export everything from `index.ts`.
- [ ] **Step 4:** Tests pass; `node quality/gate.mjs mutation`. Expected: no surviving mutant in `invite.ts` (the boundary cases at 29/30 and at the expiry millisecond kill the `<` mutants).

### Task A3: The access rule `canCoachSee` (backend-dev) - SECURITY

**Files:** Create `packages/domain/src/coach-access.ts`, `packages/domain/src/coach-access.test.ts`. Modify `packages/domain/src/index.ts`.

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest';
import { ACCESS_REFUSALS, canCoachSee, type CoachAccessFacts } from './coach-access';

const linked: CoachAccessFacts = { linked: true, sharedRepertoireIds: new Set(['r-shared']) };
const unlinked: CoachAccessFacts = { linked: false, sharedRepertoireIds: new Set(['r-shared']) };
const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });
const profile = { kind: 'profile' } as const;
const repertoire = (repertoireId: string) => ({ kind: 'repertoire', repertoireId }) as const;

describe('canCoachSee (R-13, R-39, R-42; checklist 1-3)', () => {
  it.each<[string, string, string, Parameters<typeof canCoachSee>[2], CoachAccessFacts, unknown]>([
    ['a linked coach sees the display name', 'c', 'p', profile, linked, ok],
    ['an unlinked coach sees no profile', 'c', 'p', profile, unlinked, refused(ACCESS_REFUSALS.notLinked)],
    ['a linked coach sees a repertoire shared with them', 'c', 'p', repertoire('r-shared'), linked, ok],
    ['a linked coach does not see an unshared repertoire', 'c', 'p', repertoire('r-own'), linked, refused(ACCESS_REFUSALS.notShared)],
    // After unlink the shares are gone too, but the rule does not rely on it.
    ['an unlinked coach does not see even a shared one', 'c', 'p', repertoire('r-shared'), unlinked, refused(ACCESS_REFUSALS.notLinked)],
    // Facts claiming a self link can only be a bug; the rule refuses anyway.
    ['nobody is their own coach', 'p', 'p', profile, linked, refused(ACCESS_REFUSALS.notLinked)],
  ])('%s', (_, coachId, playerId, subject, facts, expected) => {
    expect(canCoachSee(coachId, playerId, subject, facts)).toEqual(expected);
  });
});
```

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `coach-access.ts`:

```ts
import type { Result } from '@mychess/chess';

/** Message-catalogue keys; the web answers both with 404 (plan decision 4). */
export const ACCESS_REFUSALS = {
  notLinked: 'access.notLinked',
  notShared: 'access.notShared',
} as const;

export interface AccessRefusal {
  readonly reason: (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS];
}

/** What a coach wants to see of a player. S5 adds assigned repertoires. */
export type CoachSubject =
  | { readonly kind: 'profile' }
  | { readonly kind: 'repertoire'; readonly repertoireId: string };

/** The facts the rule decides on, read fresh on every request (checklist 3). */
export interface CoachAccessFacts {
  /** Is there a Coach link from this coach to this player now? */
  readonly linked: boolean;
  /** This player's repertoires shared with this coach (R-42). */
  readonly sharedRepertoireIds: ReadonlySet<string>;
}

const refuse = (reason: AccessRefusal['reason']): Result<undefined, AccessRefusal> => ({
  ok: false,
  refusal: { reason },
});

/**
 * The one access rule for coach-facing reads (ADR 0006, R-39, checklist
 * 1-3): nothing without an active Coach link; the display name with the
 * link alone; a repertoire only when the player shared it with this coach.
 */
export function canCoachSee(
  coachId: string,
  playerId: string,
  subject: CoachSubject,
  facts: CoachAccessFacts,
): Result<undefined, AccessRefusal> {
  if (coachId === playerId || !facts.linked) return refuse(ACCESS_REFUSALS.notLinked);
  if (subject.kind === 'profile') return { ok: true, value: undefined };
  return facts.sharedRepertoireIds.has(subject.repertoireId)
    ? { ok: true, value: undefined }
    : refuse(ACCESS_REFUSALS.notShared);
}
```

- [ ] **Step 4:** Tests pass; mutation run on the file, no survivors.

### Task A4: Coaching tables and migration (backend-dev) - SECURITY

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/src/accounts.ts` (the `columns` map gains `coachSince: accounts.coachSince`), `packages/db/test/accounts.test.ts` (expected accounts gain `coachSince: null`), `packages/db/test/schema.test.ts`. Create `packages/db/migrations/0002_*.sql` (generated) and its snapshot.

- [ ] **Step 1: Write the failing schema tests** in `schema.test.ts` (raw SQL through `client`, as the file already does). Add `insertAccount('c', 'coach@example.lt')` and two players `p1`, `p2` in a `beforeEach` of a new `describe('the coaching schema')`:
  - `insert into coach_links (coach_id, player_id, created_at) values ('c','c',now())` rejects with `/coach_links_not_self/`;
  - a second link `('c','p1')` rejects with `/duplicate key/`;
  - `insert into invites (coach_id, kind, token_hash, expires_at, created_at) values ('c','group', repeat('a',64), now(), now())` rejects with `/invites_group_kind/` (a group invite needs a group);
  - an invite with `token_hash = 'not-hex'` rejects with `/invites_token_hash_check/`;
  - a group invite with `used_at` set rejects with `/invites_used_personal/`;
  - a member row for `p2` (not linked) in the coach's group rejects with `/group_members_link_fk/`;
  - a member row naming coach `c`'s link but another coach's group rejects with `/group_members_group_fk/`;
  - `delete from coach_links where coach_id='c' and player_id='p1'` leaves `p1` in no group of `c` (`select count(*) from group_members` is 0), while `p1`'s membership in another coach's group stays;
  - `delete from groups` cascades its invites;
  - `delete from accounts where id='c'` leaves zero rows in `coach_links`, `groups`, `group_members` and `invites`; deleting a player who used a personal invite sets `invites.used_by` to null and keeps the invite.
- [ ] **Step 2:** `pnpm --filter @mychess/db test`. Expected: FAIL (tables missing).
- [ ] **Step 3: Implement** in `schema.ts`. Add `uuid`, `primaryKey`, `foreignKey`, `unique` to the `drizzle-orm/pg-core` import and `GROUP_NAME_MAX`, `INVITE_KINDS` to the `@mychess/domain` import. In `accounts`, after `onboardedAt`:

```ts
    /** When Coach mode was switched on (R-11); null while it is off. */
    coachSince: at('coach_since'),
```

After `adminAudit`:

```ts
/** A Coach's named set of linked players (R-12). */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    // The target of the (group, coach) foreign keys below.
    unique('groups_id_coach_unique').on(t.id, t.coachId),
    index('groups_coach_id_idx').on(t.coachId),
    // A backstop for groupNameSchema.
    check(
      'groups_name_check',
      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and ${sql.raw(String(GROUP_NAME_MAX))}`,
    ),
  ],
);

/** An accepted Coach link (R-12, R-13): the only source of coach access. */
export const coachLinks = pgTable(
  'coach_links',
  {
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'coach_links_pk', columns: [t.coachId, t.playerId] }),
    index('coach_links_player_id_idx').on(t.playerId),
    check('coach_links_not_self', sql`${t.coachId} <> ${t.playerId}`),
  ],
);

/**
 * A player in a coach's group. Both foreign keys cascade: deleting the
 * group or ending the Coach link (unlink) removes the membership in the
 * same statement, so a member is always linked (plan decision 2).
 */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id').notNull(),
    coachId: text('coach_id').notNull(),
    playerId: text('player_id').notNull(),
    /** S5 needs it: a group deadline is never before the join date (R-16). */
    joinedAt: at('joined_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'group_members_pk', columns: [t.groupId, t.playerId] }),
    foreignKey({
      name: 'group_members_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'group_members_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    index('group_members_link_idx').on(t.coachId, t.playerId),
  ],
);

/**
 * A coach's invite (R-98, R-99). Only the SHA-256 of its token is stored;
 * the raw token is shown once, when the invite is made (checklist 5).
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INVITE_KINDS }).notNull(),
    groupId: uuid('group_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: at('expires_at').notNull(),
    revokedAt: at('revoked_at'),
    usedAt: at('used_at'),
    usedBy: text('used_by').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    check('invites_kind_check', oneOf(t.kind, INVITE_KINDS)),
    check('invites_group_kind', sql`${t.kind} <> 'group' or ${t.groupId} is not null`),
    check('invites_used_personal', sql`${t.usedAt} is null or ${t.kind} = 'personal'`),
    check('invites_token_hash_check', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    // Null group: not checked (MATCH SIMPLE). Otherwise the coach's own group.
    foreignKey({
      name: 'invites_group_fk',
      columns: [t.groupId, t.coachId],
      foreignColumns: [groups.id, groups.coachId],
    }).onDelete('cascade'),
    index('invites_coach_id_idx').on(t.coachId),
  ],
);
```

- [ ] **Step 4:** `pnpm --filter @mychess/db db:generate`. Review the SQL: four `CREATE TABLE`s, `ALTER TABLE "accounts" ADD COLUMN "coach_since"`, the named constraints and indexes, nothing dropped. Commit-ready only if it matches; never edit it by hand (regenerate instead).
- [ ] **Step 5:** `pnpm --filter @mychess/db test`. Expected: PASS (the global setup migrates the container).
- [ ] **Step 6:** `node quality/gate.mjs check`. The web package may still fail where test fixtures build an `Account`; report those for Task A9.

### Task A5: Invite token and invite repositories (backend-dev) - SECURITY

**Files:** Create `packages/db/src/invite-token.ts`, `packages/db/src/invites.ts`, `packages/db/test/invite-token.test.ts`, `packages/db/test/invites.test.ts`, `packages/db/test/support/coaching.ts`. Modify `packages/db/src/index.ts`.

- [ ] **Step 1:** `test/support/coaching.ts`: `seedCoach(db, id, email, entitlement = 'free')` inserts an onboarded account with `coachSince: T0`; `seedPlayer(db, id, email)` an onboarded account without; `seedLinks(db, coachId, count)` inserts `count` players `p-1..p-n` and links them (for the 29-player setups).
- [ ] **Step 2: Write the failing tests.** `invite-token.test.ts`: `newInviteToken()` matches `inviteTokenSchema` and two calls differ; `inviteTokenHash('abc')` is `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` (the SHA-256 test vector). `invites.test.ts`:
  - `createInvite` for a coach returns `{ ok: true, value: { token, inviteId } }`; the row holds `inviteTokenHash(token)`, never `token` (`select count(*) from invites where token_hash = $1` with the raw token is 0); `expires_at` is `created_at + 7 days`;
  - `createInvite` by an account without Coach mode refuses `coach.notCoach`; a group invite naming another coach's group refuses `coach.groupNotFound` and inserts nothing;
  - `acceptInvite` of a group invite creates the link and the membership and leaves the invite active; a second player accepting the same link also gets in (R-98);
  - a personal invite is used once: the second `acceptInvite` (another player) refuses `invite.invalid`, and `used_by` is the first player (checklist 5);
  - an expired (`now` = expiry), revoked and unknown hash each refuse `invite.invalid` and change nothing;
  - the coach accepting the own invite refuses `invite.ownInvite`;
  - **concurrency, limit:** with 29 linked players and two personal invites, two `acceptInvite` calls started together (`Promise.all`, each on its own pool connection: `db` is a pool, so `db.transaction` takes separate connections) end as exactly one `ok` and one `invite.coachFull`, and `coach_links` has 30 rows for the coach. Repeat the race 5 times in a loop (fresh setup each time) so an unlocked implementation fails reliably;
  - **concurrency, single use:** two different players accepting the same personal invite together end as one link;
  - an already linked player accepting a group invite gets the membership and no second link, even at 30 players;
  - `revokeInvite(db, coachId, inviteId, now)` sets `revoked_at`; another coach revoking it refuses `invite.invalid` and changes nothing;
  - `previewInvite` returns the coach's display name and the group name for an active invite, and the same `invite.invalid` for unknown, expired, used and revoked ones;
  - `coachInvites(db, coachId, now)` lists only that coach's invites, newest first, with their state, and never a token or hash.
- [ ] **Step 3:** Run: FAIL.
- [ ] **Step 4: Implement** `invite-token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** A fresh invite token: 32 random bytes, base64url, 43 characters. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database keeps of a token (checklist 5): its SHA-256, hex. */
export function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
```

`invites.ts` (the core; split helpers as needed to keep each function under complexity 10):

```ts
import {
  canAccept,
  canInvite,
  COACH_REFUSALS,
  INVITE_REFUSALS,
  inviteExpiry,
  inviteSchema,
  inviteState,
  type CoachRefusal,
  type Invite,
  type InviteKind,
  type InviteRefusal,
  type Result,
} from '@mychess/domain';
// coachInvites (below) also needs desc, inviteState and InviteState.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Executor, Tx } from './client';
import { findAccountById } from './accounts';
import { newInviteToken, inviteTokenHash } from './invite-token';
import { accounts, coachLinks, groupMembers, groups, invites } from './schema';

const inviteColumns = {
  id: invites.id,
  coachId: invites.coachId,
  kind: invites.kind,
  groupId: invites.groupId,
  expiresAt: invites.expiresAt,
  revokedAt: invites.revokedAt,
  usedAt: invites.usedAt,
  createdAt: invites.createdAt,
};

const invalid = <T>(): Result<T, InviteRefusal> => ({
  ok: false,
  refusal: { reason: INVITE_REFUSALS.invalid },
});

export interface NewInvite {
  readonly coachId: string;
  readonly kind: InviteKind;
  /** Required for a group invite; optional for a personal one. */
  readonly groupId: string | null;
  readonly now: Date;
}

/** Makes an invite; the raw token is returned here once and never stored. */
export async function createInvite(
  db: Db,
  input: NewInvite,
): Promise<Result<{ token: string; inviteId: string }, CoachRefusal>> {
  return db.transaction(async (tx) => {
    const coach = await findAccountById(tx, input.coachId);
    const allowed = coach === undefined ? null : canInvite(coach);
    if (allowed === null) return { ok: false, refusal: { reason: COACH_REFUSALS.notCoach } };
    if (!allowed.ok) return allowed;
    if (input.groupId !== null && !(await ownsGroup(tx, input.coachId, input.groupId)))
      return { ok: false, refusal: { reason: COACH_REFUSALS.groupNotFound } };
    const token = newInviteToken();
    const [row] = await tx
      .insert(invites)
      .values({
        coachId: input.coachId,
        kind: input.kind,
        groupId: input.groupId,
        tokenHash: inviteTokenHash(token),
        expiresAt: inviteExpiry(input.now),
        createdAt: input.now,
      })
      .returning({ id: invites.id });
    return { ok: true, value: { token, inviteId: z.uuid().parse(row?.id) } };
  });
}

async function ownsGroup(db: Executor, coachId: string, groupId: string): Promise<boolean> {
  const rows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.coachId, coachId)))
    .limit(1);
  return rows.length === 1;
}

/** The invite with this hash, locked for the rest of `tx` (single use). */
async function lockInvite(tx: Tx, tokenHash: string): Promise<Invite | undefined> {
  const [row] = await tx
    .select(inviteColumns)
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .for('update');
  return row === undefined ? undefined : inviteSchema.parse(row);
}

/**
 * The coach behind an invite, with the coach's row locked for the rest of
 * `tx`: every transaction that adds a link, a group or switches Coach mode
 * off for this coach takes this lock first, so the counts read after it are
 * final (plan decision 1).
 */
async function lockCoach(tx: Tx, coachId: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, coachId))
    .for('no key update');
  return row === undefined ? undefined : findAccountById(tx, coachId);
}

const linkCount = (tx: Tx, coachId: string) =>
  tx.$count(coachLinks, eq(coachLinks.coachId, coachId));

const isLinked = async (tx: Tx, coachId: string, playerId: string) =>
  (await tx.$count(coachLinks, and(eq(coachLinks.coachId, coachId), eq(coachLinks.playerId, playerId)))) > 0;

export interface AcceptedInvite {
  readonly coachId: string;
  readonly groupId: string | null;
}

/**
 * Accepts an invite as `playerId` (the session account, never a client
 * value): locks the invite, then the coach, then counts, so two accepts
 * can never exceed the player limit or use a personal invite twice.
 */
export function acceptInvite(
  db: Db,
  tokenHash: string,
  playerId: string,
  now: Date,
): Promise<Result<AcceptedInvite, InviteRefusal>> {
  return db.transaction(async (tx) => {
    const invite = await lockInvite(tx, tokenHash);
    if (invite === undefined) return invalid();
    const coach = await lockCoach(tx, invite.coachId);
    if (coach === undefined) return invalid();
    const alreadyLinked = await isLinked(tx, coach.id, playerId);
    const counts = { linkedPlayers: await linkCount(tx, coach.id), alreadyLinked };
    const check = canAccept(invite, playerId, coach, counts, now);
    if (!check.ok) return check;
    await link(tx, invite, playerId, alreadyLinked, now);
    return { ok: true, value: { coachId: coach.id, groupId: invite.groupId } };
  });
}

async function link(tx: Tx, invite: Invite, playerId: string, alreadyLinked: boolean, now: Date) {
  if (!alreadyLinked)
    await tx.insert(coachLinks).values({ coachId: invite.coachId, playerId, createdAt: now });
  if (invite.groupId !== null)
    await tx
      .insert(groupMembers)
      .values({ groupId: invite.groupId, coachId: invite.coachId, playerId, joinedAt: now })
      .onConflictDoNothing();
  if (invite.kind === 'personal')
    await tx.update(invites).set({ usedAt: now, usedBy: playerId }).where(eq(invites.id, invite.id));
}
```

`revokeInvite(db, coachId, inviteId, now)`: `update invites set revoked_at = now where id = inviteId and coach_id = coachId and revoked_at is null returning id`; no row -> `invalid()`. `previewInvite(db, tokenHash, playerId, now)` reads the invite and coach **without** locks, counts as above, runs `canAccept` and on success returns `{ coachDisplayName, groupName: string | null, kind }` (join `groups` for the name); every refusal passes through unchanged. `coachInvites(db, coachId, now)` selects `inviteColumns` plus `groups.name` (left join) where `coach_id = coachId`, `order by created_at desc limit 50`, parses each row with `inviteSchema.extend({ groupName: z.string().nullable() })` and maps it to `{ id, kind, groupName, state: inviteState(row, now), expiresAt, createdAt }`.

Export `newInviteToken` (not needed outside; keep it internal), `inviteTokenHash`, `createInvite`, `acceptInvite`, `revokeInvite`, `previewInvite`, `coachInvites` and their result types from `index.ts`.
- [ ] **Step 5:** Tests pass, including the race tests five times in a row. Also run the race test against a deliberately broken copy (comment out `.for('no key update')` locally, run, restore) and report that it then fails: proof the test detects the race. Do not commit the broken copy.
- [ ] **Step 6:** `node quality/gate.mjs check`.

### Task A6: Coach mode, links and access facts (backend-dev) - SECURITY

**Files:** Create `packages/db/src/coaching.ts`, `packages/db/test/coaching.test.ts`. Modify `packages/db/src/index.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `startCoaching(db, id, now)` sets `coach_since` once; a second call keeps the first time;
  - `stopCoaching` with one linked player refuses `coach.stillLinked` and keeps `coach_since`; with none it sets it to null (R-100); a `stopCoaching` racing an `acceptInvite` for the last free state ends either "stopped, accept refused `invite.invalid` (R-109 revokes the open invites)" or "accepted, stop refused", never both succeeding (run 5 times);
  - `coachPlayers(db, coachId)` lists each linked player's id, display name, linked time and that coach's groups for them, ordered by display name; another coach's players and groups never appear;
  - `coachPlayer(db, coachId, playerId)` returns the same shape for one linked player and `undefined` for an unlinked one;
  - `playerCoaches(db, playerId)` lists each coach's id and display name and the player's groups of that coach;
  - `unlink(db, coachId, playerId)` removes the link, the player's memberships in that coach's groups (and, after Part B, the shares with that coach) and returns `true`; the player's other coach's link and groups stay; a second call returns `false`;
  - `coachAccessFacts(db, coachId, playerId)` is `{ linked: true, sharedRepertoireIds: new Set() }` for a link and `linked: false` otherwise.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** Key pieces:

```ts
/** Switches Coach mode off unless a player is linked (R-100). */
export function stopCoaching(db: Db, coachId: string, now: Date): Promise<Result<undefined, CoachRefusal>> {
  return db.transaction(async (tx) => {
    // The same coach-row lock acceptInvite takes (plan decision 1).
    await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, coachId)).for('no key update');
    const check = canStopCoaching(await tx.$count(coachLinks, eq(coachLinks.coachId, coachId)));
    if (!check.ok) return check;
    await tx.update(accounts).set({ coachSince: null, updatedAt: now }).where(eq(accounts.id, coachId));
    return check;
  });
}

/**
 * Ends a Coach link, from either side (spec, lead decision). The foreign
 * keys onto coach_links remove the coach's group memberships and shares
 * for this player in the same statement (plan decision 2).
 */
export async function unlink(db: Executor, coachId: string, playerId: string): Promise<boolean> {
  const removed = await db
    .delete(coachLinks)
    .where(and(eq(coachLinks.coachId, coachId), eq(coachLinks.playerId, playerId)))
    .returning({ playerId: coachLinks.playerId });
  return removed.length === 1;
}

/** The facts canCoachSee decides on, read fresh on every request (checklist 3). */
export async function coachAccessFacts(db: Executor, coachId: string, playerId: string): Promise<CoachAccessFacts> {
  const linked =
    (await db.$count(coachLinks, and(eq(coachLinks.coachId, coachId), eq(coachLinks.playerId, playerId)))) > 0;
  // Part B (Task B4) fills this from repertoire_shares joined on coach_links.
  return { linked, sharedRepertoireIds: new Set<string>() };
}
```

`startCoaching`: `update accounts set coach_since = coalesce(coach_since, now), updated_at = now where id`. `coachPlayers` is one query `from coach_links join accounts on accounts.id = coach_links.player_id where coach_links.coach_id = coachId`, plus one query for that coach's memberships (`group_members join groups where group_members.coach_id = coachId`) merged in memory; both results parsed with zod. `coachPlayer` adds `and player_id = playerId` to both.
- [ ] **Step 4:** Tests pass; `node quality/gate.mjs check`.

### Task A7: Group repositories (backend-dev) - SECURITY

**Files:** Create `packages/db/src/groups.ts`, `packages/db/test/groups.test.ts`. Modify `packages/db/src/index.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `createGroup(db, coachId, 'Šeštadienio grupė', now)` returns the id; the 11th group refuses `coach.groupLimit` (R-70); two `createGroup` calls racing at 9 groups end with exactly 10 (run 5 times); a non-coach refuses `coach.notCoach`;
  - `renameGroup` and `deleteGroup` change only the coach's own group and return `false` for another coach's group id;
  - `addMember(db, coachId, groupId, playerId, now)` adds a linked player and refuses an unlinked one with `coach.notLinked` and another coach's group with `coach.groupNotFound`; adding twice is a no-op `ok`;
  - `removeMember(db, coachId, groupId, playerId)` removes only from the coach's own group;
  - `leaveGroup(db, playerId, groupId)` removes the player's membership and keeps the Coach link (R-45);
  - `coachGroups(db, coachId)` lists the groups with member counts, ordered by name; `coachGroup(db, coachId, groupId)` returns the group with its members' ids and display names, or `undefined` for another coach's group.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `createGroup` locks the coach row (`for('no key update')`), reads the account with `findAccountById(tx, coachId)`, counts `groups` for the coach, calls `canCreateGroup(coach, count)` and inserts. The name it receives is already parsed (`groupNameSchema` at the edge); the CHECK is the backstop. `addMember`:

```ts
/** Puts a linked player into the coach's own group (R-12). */
export function addMember(
  db: Db,
  coachId: string,
  groupId: string,
  playerId: string,
  now: Date,
): Promise<Result<undefined, CoachRefusal>> {
  return db.transaction(async (tx) => {
    if (!(await ownsGroup(tx, coachId, groupId)))
      return { ok: false, refusal: { reason: COACH_REFUSALS.groupNotFound } };
    if (!(await isLinked(tx, coachId, playerId)))
      return { ok: false, refusal: { reason: COACH_REFUSALS.notLinked } };
    // The composite foreign keys are the backstop if an unlink races this.
    await tx.insert(groupMembers).values({ groupId, coachId, playerId, joinedAt: now }).onConflictDoNothing();
    return { ok: true, value: undefined };
  });
}
```

Move `ownsGroup` and `isLinked` from `invites.ts` into a small shared module `packages/db/src/coach-queries.ts` and import them in both. `removeMember` and `leaveGroup` are single `delete ... where` statements that include `coach_id = coachId` (coach side) or `player_id = playerId` (player side).
- [ ] **Step 4:** Tests pass; `node quality/gate.mjs check`.

### Task A8: Account delete and export with coaching rows (backend-dev) - SECURITY

**Files:** Modify `packages/db/test/accounts.test.ts`, `packages/db/src/accounts.ts` (comment only).

- [ ] **Step 1:** Add to `accounts.test.ts`: a coach with two linked players, a group with both, a personal invite used by one, and a group invite. `deleteAccount(db, coach)` leaves zero rows in `coach_links`, `groups`, `group_members` and `invites`, and both players' accounts intact. `deleteAccount(db, player)` removes that player's link and memberships, keeps the other player's, and keeps the personal invite with `used_by` null.
- [ ] **Step 2:** Run. Expected: PASS straight away (the cascades are in the schema); if it fails, the schema is wrong: fix Task A4, not the test.
- [ ] **Step 3:** Update the `deleteAccount` doc comment: "Later slices extend the cascade" now names S4's tables. The export gains a `coaching` section (R-106), in `account-export.ts`.

### Task A9: Return path through sign-in and onboarding (web-dev) - SECURITY

**Files:** Create `apps/web/src/lib/return-path.ts`, `apps/web/src/lib/return-path.test.ts`, `apps/web/test/feature/return-path.test.ts`. Modify `apps/web/src/lib/routes.ts`, `apps/web/src/app/prisijungti/page.tsx`, `sign-in-form.tsx`, `sign-in-form.test.tsx`, `apps/web/src/app/pradzia/page.tsx`, `onboarding-form.tsx`, `onboarding-form.test.tsx`, `actions.ts`, any web test fixture that builds an `Account` (add `coachSince: null`).

- [ ] **Step 1: Write the failing unit tests** `return-path.test.ts` (component project, no database):

```ts
import { describe, expect, it } from 'vitest';
import { onboardingPath, returnPath, signInPath } from './return-path';

const TOKEN = 'A'.repeat(42) + '_';

describe('returnPath (open-redirect guard)', () => {
  it('keeps an invite path', () => {
    expect(returnPath(`/k/${TOKEN}`)).toBe(`/k/${TOKEN}`);
  });
  it.each([
    ['an absolute URL', `https://evil.example/k/${TOKEN}`],
    ['a protocol-relative URL', `//evil.example/k/${TOKEN}`],
    ['a backslash', `/\\evil.example/k/${TOKEN}`],
    ['an encoded slash', `/k%2F${TOKEN}`],
    ['a dot segment', `/k/../${TOKEN}`],
    ['a query', `/k/${TOKEN}?x=1`],
    ['another page', '/nustatymai'],
    ['a short token', `/k/${TOKEN.slice(1)}`],
    ['a non-string', 42],
    ['nothing', null],
  ])('drops %s', (_, raw) => {
    expect(returnPath(raw)).toBeNull();
  });
});

describe('signInPath / onboardingPath', () => {
  it('carry a kept path as ?next=', () => {
    expect(signInPath(`/k/${TOKEN}`)).toBe(`/prisijungti?next=%2Fk%2F${TOKEN}`);
    expect(onboardingPath(`/k/${TOKEN}`)).toBe(`/pradzia?next=%2Fk%2F${TOKEN}`);
  });
  it('are the plain pages without one', () => {
    expect(signInPath(null)).toBe('/prisijungti');
    expect(onboardingPath(null)).toBe('/pradzia');
  });
});
```

`sign-in-form.test.tsx` gains: rendered with `next="/k/<TOKEN>"`, the magic link and both provider buttons send `callbackURL: '/k/<TOKEN>'`, `newUserCallbackURL: '/pradzia?next=%2Fk%2F<TOKEN>'`, `errorCallbackURL: '/prisijungti?next=%2Fk%2F<TOKEN>'`; without `next` the URLs stay as today. `onboarding-form.test.tsx`: with `next` the form posts a hidden `next` field.

Feature test `test/feature/return-path.test.ts` (mocks as in `settings.test.ts`):
  - `completeOnboardingAction` with a valid `next` redirects to it; with `next=//evil.example` it redirects to `/`; an already onboarded account with a valid `next` goes to `next`;
  - the sign-in page (`SignInPage({ searchParams })`) of a signed-in account with `next=/k/<TOKEN>` redirects there, and with `next=https://evil.example` to `/`;
  - **magic link:** `requestMagicLink(built(), { email, callbackURL: '/k/<TOKEN>', newUserCallbackURL: '/pradzia?next=%2Fk%2F<TOKEN>' })` for a new email; following the mailed link answers a redirect whose `location` is `/pradzia?next=%2Fk%2F<TOKEN>`; for an existing account it is `/k/<TOKEN>`;
  - **Google (G-M1-1, part 1):** `oauthRoundTrip(built(), 'google', { body: { callbackURL: '/k/<TOKEN>', newUserCallbackURL: '/pradzia?next=%2Fk%2F<TOKEN>' } })` with `rebuildAuth({ fetch: fakeProviderFetch({ google: { sub: 'g-1', email, email_verified: true, name: 'Gabija' } }) })`: a new identity lands on `/pradzia?next=...`, the same identity again on `/k/<TOKEN>`;
  - **Better Auth refuses a foreign callback:** `requestMagicLink(built(), { email, callbackURL: 'https://evil.example/' })` answers 403 and mails nothing.
- [ ] **Step 2:** Run `pnpm --filter @mychess/web test:component` and `test:feature`. Expected: FAIL.
- [ ] **Step 3: Implement** `return-path.ts`:

```ts
import { inviteTokenSchema } from '@mychess/domain';
import { ROUTES } from './routes';

const INVITE_PREFIX = '/k/';

/**
 * Where to send a person back to after sign-in or onboarding (R-81): only
 * an invite page with a well-formed token. Anything else is null, so no
 * `?next=` can send a browser off the site or to a page we did not mean.
 */
export function returnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith(INVITE_PREFIX)) return null;
  return inviteTokenSchema.safeParse(raw.slice(INVITE_PREFIX.length)).success ? raw : null;
}

const withNext = (page: string, next: string | null): string =>
  next === null ? page : `${page}?next=${encodeURIComponent(next)}`;

export const signInPath = (next: string | null): string => withNext(ROUTES.signIn, next);
export const onboardingPath = (next: string | null): string => withNext(ROUTES.onboarding, next);
```

`routes.ts` gains `coach: '/treneris'`, `myCoaches: '/nustatymai#treneriai'`, and helpers `invitePath(token)`, `coachPlayerPath(playerId)`, `coachGroupPath(groupId)` (each `encodeURIComponent`s its id).

Sign-in page: reads `next` with `returnPath(first(params['next']))`; a signed-in account goes to `next ?? ROUTES.home`; passes `next` to `SignInForm`. `SignInForm` builds its URLs from a pure `callbackUrls(next)` (replacing the `URLS` constant): `{ callbackURL: next ?? ROUTES.home, newUserCallbackURL: onboardingPath(next), errorCallbackURL: signInPath(next) }`. Onboarding page: `next = returnPath(first(params['next']))`; an onboarded account goes to `next ?? ROUTES.home`; `OnboardingForm` gets `next` and renders `<input type="hidden" name="next" value={next} />` when set. `completeOnboardingAction`: `const next = returnPath(form.get('next'))`, and both redirects become `redirect(next ?? ROUTES.home)`. `returnPath` runs again on the server: the hidden field is client input.
- [ ] **Step 4:** All web suites pass; `node quality/gate.mjs check`.

### Task A10: Coach access helpers in the web (web-dev) - SECURITY

**Files:** Create `apps/web/src/server/coaching.ts`, `apps/web/src/server/coach-pages.ts`. Modify `apps/web/test/feature/support/request.ts` (the `next/navigation` mock gains `notFound`).

- [ ] **Step 1:** In `support/request.ts`, add a `NotFound` error class and extend `nextNavigation()` with `notFound: () => { throw new NotFound(); }`; `outcomeOf` maps it to `{ notFound: true }`. Update the file's own tests if any assert the mock's shape.
- [ ] **Step 2: Implement** `coaching.ts`:

```ts
import { coachAccessFacts } from '@mychess/db';
import { canCoachSee, isCoach, type Account, type CoachSubject } from '@mychess/domain';
import { notFound, redirect } from 'next/navigation';
import { ROUTES } from '../lib/routes';
import { getDb } from './db';
import { requireOnboarded } from './session';

/** The session account with Coach mode on; others go to settings, where the switch is. */
export async function requireCoach(): Promise<Account> {
  const account = await requireOnboarded();
  if (!isCoach(account)) redirect(ROUTES.settings);
  return account;
}

/**
 * Every coach-facing read starts here (checklist 1-3): the facts are read
 * on this request, the domain decides, and a refusal is a plain 404.
 * The query that follows joins coach_links again.
 */
export async function assertCoachMaySee(coach: Account, playerId: string, subject: CoachSubject): Promise<void> {
  const facts = await coachAccessFacts(getDb(), coach.id, playerId);
  if (!canCoachSee(coach.id, playerId, subject, facts).ok) notFound();
}
```

`coach-pages.ts`: one loader per coach page, each starting with `requireCoach()`:
  - `coachHomeData()`: `{ players: coachPlayers(...), groups: coachGroups(...), invites: coachInvites(..., new Date()) }`;
  - `coachPlayerData(rawPlayerId)`: parses the id (`z.string().min(1).max(100)`, else `notFound()`), `assertCoachMaySee(coach, playerId, { kind: 'profile' })`, then `coachPlayer(getDb(), coach.id, playerId) ?? notFound()`;
  - `coachGroupData(rawGroupId)`: parses `z.uuid()`, then `coachGroup(getDb(), coach.id, groupId) ?? notFound()` (a group is the coach's own data, not a player's; the query filters on the coach).
- [ ] **Step 3:** Unit coverage comes from Task A15's feature suite; run `node quality/gate.mjs check` (knip may flag the loaders until Task A12 uses them; report and carry on).

### Task A11: Coach mode switch and "Mano treneriai" in settings (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/nustatymai/coach-mode.tsx`, `coach-mode.test.tsx`, `my-coaches.tsx`, `my-coaches.test.tsx`, `coaching-actions.ts`, `apps/web/test/feature/coach-mode.test.ts`, `apps/web/test/feature/my-coaches.test.ts`. Modify `apps/web/src/app/nustatymai/page.tsx`, `apps/web/src/app/home-view.tsx`, `apps/web/src/app/page.tsx`, both catalogues.

- [ ] **Step 1: Write the failing feature tests.** `coach-mode.test.ts`:
  - `startCoachingAction()` switches Coach mode on for the session account only;
  - `stopCoachingAction()` with no linked player switches it off; with linked Rokas and Gabija it returns `{ refusal: 'coach.stillLinked', players: [{ id, displayName: 'Gabija' }, { id, displayName: 'Rokas' }] }` and stays on (R-100);
  - signed out, both redirect to `/prisijungti`.

  `my-coaches.test.ts`:
  - `unlinkCoachAction(form{coachId})` as the player removes that link, and the coach's next `coachPlayerData(playerId)` is `{ notFound: true }` (checklist 3);
  - with the `coachId` of a coach the player is not linked to, it changes nothing (checklist 4);
  - `leaveGroupAction(form{groupId})` removes the membership and keeps the link (R-45); a `groupId` of a group the player is not in changes nothing;
  - forms carrying an extra `playerId` field act on the session account only (checklist 4).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `coaching-actions.ts` (`'use server'`):

```ts
const coachIdSchema = z.object({ coachId: z.string().min(1).max(100) });
const groupIdSchema = z.object({ groupId: z.uuid() });

export interface StopCoachingState {
  readonly refusal?: CoachRefusal['reason'];
  /** The players to unlink first (R-100). */
  readonly players?: readonly { readonly id: string; readonly displayName: string }[];
}

export async function stopCoachingAction(_: StopCoachingState): Promise<StopCoachingState> {
  const account = await requireOnboarded();
  const result = await stopCoaching(getDb(), account.id, new Date());
  if (!result.ok) {
    const players = await coachPlayers(getDb(), account.id);
    return { refusal: result.refusal.reason, players: players.map(({ id, displayName }) => ({ id, displayName })) };
  }
  refresh();
  return {};
}

/** The player ends a Coach link (spec: either side may unlink). */
export async function unlinkCoachAction(form: FormData): Promise<void> {
  const player = await requireOnboarded();
  const parsed = coachIdSchema.safeParse({ coachId: form.get('coachId') });
  if (parsed.success) await unlink(getDb(), parsed.data.coachId, player.id);
  refresh();
}
```

`startCoachingAction` calls `startCoaching(getDb(), account.id, new Date())` and `refresh()`; `leaveGroupAction` mirrors `unlinkCoachAction` with `leaveGroup(getDb(), player.id, groupId)`. The settings page loads `playerCoaches(getDb(), account.id)` and renders, after the profile form: `CoachMode` (a switch button: "Switch Coach mode on" / "Switch Coach mode off"; a refusal shows `coach.stillLinked` and the list of players, each linking to `coachPlayerPath(id)`) and `MyCoaches` (`<section id="treneriai">`: each coach's display name, their groups with "Leave group", and "Unlink" behind a confirm step). Home: `HomeView` gets `isCoach` and shows a link to `/treneris` ("Coach area") when true. Catalogue keys: `settings.coachMode.{title,intro,on,off,switchOn,switchOff,unlinkFirst}`, `settings.myCoaches.{title,empty,unlink,unlinkConfirm,leaveGroup,groups}`, `coach.stillLinked`, `app.coachArea`. LT first, from `docs/glossary-lt.md`: Coach mode **trenerio režimas**, unlink **atsieti**, group **grupė**, "Mano treneriai".
- [ ] **Step 4:** Component tests: the switch posts the right action; the refusal lists the players; Unlink needs the confirm step. Tests pass; `node quality/gate.mjs check`; screenshots at 390px and 1280px, light and dark, for ux-designer.

### Task A12: Coach area `/treneris`: players, groups, invites (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/treneris/page.tsx`, `players-list.tsx`, `groups-section.tsx`, `invites-section.tsx` (each with a `.test.tsx`), `apps/web/src/app/treneris/actions.ts`, `apps/web/test/feature/invites.test.ts` (coach half), `apps/web/test/feature/groups.test.ts`. Modify both catalogues.

- [ ] **Step 1: Write the failing feature tests.**
  `groups.test.ts`: `createGroupAction(form{name: '  Šeštadienio grupė '})` creates the trimmed group; a blank name returns `{ refusal: 'groupName.blank' }`; the 11th returns `{ refusal: 'coach.groupLimit' }`; `renameGroupAction` and `deleteGroupAction` with another coach's `groupId` change nothing; an account without Coach mode is redirected to `/nustatymai`.
  `invites.test.ts` (coach half): `createInviteAction(form{kind: 'group', groupId})` returns `{ link: 'http://localhost:3000/k/<43 chars>' }` (built from `BETTER_AUTH_URL`), and `invites` holds the hash of that token; `kind: 'group'` without a group returns `{ refusal: 'invite.groupRequired' }` (a form-level zod issue key); a group of another coach returns `{ refusal: 'coach.groupNotFound' }`; `revokeInviteAction(form{inviteId})` revokes the own invite and leaves another coach's alone.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `actions.ts` (`'use server'`), every action `requireCoach()` first:

```ts
const inviteFormSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal'), groupId: z.uuid().nullable() }),
  z.object({ kind: z.literal('group'), groupId: z.uuid('invite.groupRequired') }),
]);

export interface CreateInviteState {
  readonly link?: string;
  readonly refusal?: string;
}

/** Makes an invite and shows its link once (plan decision 5). */
export async function createInviteAction(_: CreateInviteState, form: FormData): Promise<CreateInviteState> {
  const coach = await requireCoach();
  const groupId = form.get('groupId');
  const parsed = inviteFormSchema.safeParse({
    kind: form.get('kind'),
    groupId: typeof groupId === 'string' && groupId !== '' ? groupId : null,
  });
  if (!parsed.success) return { refusal: parsed.error.issues[0]?.message ?? 'invite.invalid' };
  const made = await createInvite(getDb(), { coachId: coach.id, ...parsed.data, now: new Date() });
  if (!made.ok) return { refusal: made.refusal.reason };
  refresh();
  return { link: new URL(invitePath(made.value.token), readWebEnv().BETTER_AUTH_URL).toString() };
}
```

`createGroupAction` parses `groupNameSchema` and calls `createGroup(getDb(), coach.id, name, new Date())`; `renameGroupAction`, `deleteGroupAction`, `revokeInviteAction`, `addMemberAction`, `removeMemberAction` and `unlinkPlayerAction` parse their ids with zod and pass `coach.id` from the session. The page calls `coachHomeData()` and renders three sections:
  - **Players:** display name (link to the player page), groups, Unlink (confirm step).
  - **Groups:** create form (name), each group with its member count and a link to its page.
  - **Invites:** a form (personal or group; the group picker lists the coach's groups, optional for personal), the fresh link once in a read-only field with a Copy button (`navigator.clipboard.writeText`), and the list (kind, group, state as text, expiry date in Europe/Vilnius, Revoke for active ones).

  Catalogue keys under `coach`: `title`, `players.*`, `groups.*`, `invites.*` (`create`, `personal`, `group`, `link`, `copy`, `copied`, `linkOnce`, `state.active|expired|used|revoked`, `expires`, `revoke`), `groupName.blank`, `groupName.tooLong`, `invite.groupRequired`, `coach.groupLimit`, `coach.groupNotFound`, `coach.notLinked`, `coach.notCoach`.
- [ ] **Step 4:** Tests pass; gate passes; screenshots as in Task A11.

### Task A13: Player and group pages in the coach area (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/treneris/zaidejai/[playerId]/page.tsx`, `apps/web/src/app/treneris/grupes/[groupId]/page.tsx` and their presentational components with component tests. Modify both catalogues.

- [ ] **Step 1:** Component tests for the views: the player view shows the display name, the player's groups and Unlink; the group view shows rename, delete (confirm step), the members with Remove, and an "Add player" picker listing linked players not yet in the group.
- [ ] **Step 2: Implement.** The pages are thin: `const data = await coachPlayerData((await params).playerId)` / `coachGroupData(...)`, then render the view. Nothing on these pages reads the database except through the loaders (Task A10). The player page shows only the display name and the coach's own groups (subject `profile`), never the email (R-50 spirit: the coach needs the name; the spec names "display name").
- [ ] **Step 3:** Tests pass; gate passes; screenshots.

### Task A14: Invite page `/k/[token]` and accepting (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/k/[token]/page.tsx`, `invite-view.tsx`, `invite-view.test.tsx`, `actions.ts`. Extend `apps/web/test/feature/invites.test.ts` (player half). Modify both catalogues.

- [ ] **Step 1: Write the failing feature tests** (player half of `invites.test.ts`):
  - signed out, the page redirects to `/prisijungti?next=%2Fk%2F<TOKEN>`; signed in but not onboarded, to `/pradzia?next=%2Fk%2F<TOKEN>`;
  - `acceptInviteAction(form{token})` as Rokas on a group invite creates the link and the membership and redirects to `/nustatymai#treneriai`;
  - a malformed, unknown, expired (the invite row's `expires_at` set to the past through `sql`), revoked and used personal token each return `{ refusal: 'invite.invalid' }` and create nothing (checklist 5);
  - the coach accepting the own invite returns `{ refusal: 'invite.ownInvite' }`;
  - a form with an extra `playerId` of another account links the session account, not that one (checklist 4);
  - **G-M1-1, part 2:** Gabija signed in through `oauthRoundTrip(..., 'google', ...)` with a fake verified Google identity and onboarded; `acceptInviteAction` links her; `accounts` has exactly one row with her email (no duplicate account); her coach's group lists her;
  - the page never accepts: loading `/k/<TOKEN>` as a signed-in player leaves `coach_links` empty (decision 8).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `page.tsx`:

```tsx
export default async function InvitePage({ params }: { readonly params: Promise<{ token: string }> }): Promise<JSX.Element> {
  const { token } = await params;
  const back = returnPath(invitePath(token));
  const account = await getAccount();
  if (account === null) redirect(signInPath(back));
  if (!isOnboarded(account)) redirect(onboardingPath(back));
  const preview =
    back === null
      ? ({ ok: false, refusal: { reason: INVITE_REFUSALS.invalid } } as const)
      : await previewInvite(getDb(), inviteTokenHash(token), account.id, new Date());
  return <InviteView token={token} preview={preview} />;
}
```

`actions.ts` (`'use server'`):

```ts
export interface AcceptState {
  readonly refusal?: InviteRefusal['reason'];
}

/** Accepts as the session account (checklist 4); never on GET (decision 8). */
export async function acceptInviteAction(_: AcceptState, form: FormData): Promise<AcceptState> {
  const player = await requireOnboarded();
  const token = inviteTokenSchema.safeParse(form.get('token'));
  if (!token.success) return { refusal: INVITE_REFUSALS.invalid };
  const accepted = await acceptInvite(getDb(), inviteTokenHash(token.data), player.id, new Date());
  if (!accepted.ok) return { refusal: accepted.refusal.reason };
  redirect(ROUTES.myCoaches);
}
```

`InviteView`: on `ok`, "<coach> invites you to be your coach" plus the group name if any, and Accept / "Not now" (to home); on a refusal, the catalogue text (`invite.invalid` is the one generic text for unknown, expired, used and revoked; `invite.notCoach` uses the same wording; `invite.ownInvite` and `invite.coachFull` say what happened). Catalogue keys under `invite`: `title`, `fromCoach`, `toGroup`, `accept`, `notNow`, `invalid`, `ownInvite`, `coachFull`, `notCoach`.
- [ ] **Step 4:** Tests pass; gate passes; screenshots of the confirm and refusal states.

### Task A15: Coach access suite, checklist 1-4 (qa with web-dev) - SECURITY

**Files:** Create `apps/web/test/feature/coach-access.test.ts`.

- [ ] **Step 1: Write the suite.** Setup per test: coach Rimantas linked to Rokas, with group "Šeštadienio grupė" containing Rokas; coach Dovydas linked to nobody; player Gabija linked only to Dovydas. A table drives every coach page loader and every coach action:

```ts
// Every page under src/app/treneris has one entry; the guard below fails
// when a page is added without one (plan decision 14).
const COACH_PAGES: Record<string, (ids: Ids) => Promise<unknown>> = {
  'treneris': () => coachHomeData(),
  'treneris/zaidejai/[playerId]': (ids) => coachPlayerData(ids.rokas),
  'treneris/grupes/[groupId]': (ids) => coachGroupData(ids.group),
  // Part B adds 'treneris/zaidejai/[playerId]/repertuarai/[repertoireId]'.
};

it('covers every coach page', () => {
  const pages = readdirSync(join(APP, 'treneris'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('page.tsx'))
    .map((file) => posix.join('treneris', dirname(file).split(sep).join('/')).replace(/\/\.$/, ''));
  expect(new Set(pages)).toEqual(new Set(Object.keys(COACH_PAGES)));
});
```

  Cases, each against every row that takes a player or group:
  - **checklist 1:** signed in as Dovydas (a coach, not linked to Rokas), each player and group loader answers `{ notFound: true }`; each coach action naming Rokas or Rimantas's group changes nothing (compare row counts of `coach_links`, `group_members`, `groups`, `invites` before and after);
  - **checklist 1, home:** Dovydas's `coachHomeData()` lists no player and no group of Rimantas; Rimantas's lists Rokas only, never Gabija;
  - **checklist 3:** Rimantas loads Rokas's page; Rokas unlinks (`unlinkCoachAction`); Rimantas's next `coachPlayerData` is `{ notFound: true }` and the group no longer lists Rokas; the same after Rimantas unlinks from his side;
  - **checklist 4:** `unlinkPlayerAction(form{playerId: gabija})` as Rimantas leaves Dovydas's link to Gabija; `addMemberAction(form{groupId, playerId: gabija})` refuses `coach.notLinked`; `removeMemberAction` with Dovydas's group id changes nothing;
  - **not a coach:** an account without Coach mode is redirected to `/nustatymai` by every loader and action;
  - **signed out:** every loader and action redirects to `/prisijungti`.
- [ ] **Step 2:** Run `pnpm --filter @mychess/web test:feature`. Expected: PASS once Tasks A10-A14 are in; any failure is a finding for the owning task.
- [ ] **Step 3:** `node quality/gate.mjs check`.

### Task A16: Lithuanian and English review (i18n-content) - UX

**Files:** Modify `apps/web/src/i18n/messages/{lt,en}.json`; `docs/glossary-lt.md` if new terms.

- [ ] **Step 1:** Review every key added in Tasks A11-A14 against `docs/glossary-lt.md`: Coach **treneris**, Coach mode **trenerio režimas**, Coach link **ryšys su treneriu**, link/unlink **susieti/atsieti** (never **prisijungti**, never **prijungti/atjungti**, which are for sign-in methods), Invite **kvietimas**, invite link **kvietimo nuoroda**, Group **grupė**, Accept/Decline **priimti/atmesti**, Remove **pašalinti**, Delete **ištrinti**. Add "personal invite" and "group invite" (proposals: **asmeninis kvietimas**, **grupės kvietimas**) and "Revoke" (proposal: **atšaukti kvietimą**) to the glossary as proposed terms for the owner.
- [ ] **Step 2:** Check the generic refusal: `invite.invalid` must not hint at the reason. Check placeholders (`{coach}`, `{group}`, `{date}`) in both languages.
- [ ] **Step 3:** `node quality/gate.mjs check`. Report every changed key with the reason.

### Task A17: Visual sign-off (ux-designer) - UX

- [ ] **Step 1:** Review the screenshots of Tasks A11-A14 at 390px and 1280px, light and dark: the settings sections, `/treneris`, the player and group pages, the invite confirm and refusal states. Check touch targets (44px, `min-h-touch`), the shared button classes (`apps/web/src/app/buttons.ts`), the `StatusLine` for outcomes, the copy-link affordance on a phone, and keyboard reachability.
- [ ] **Step 2:** Report blocking and advisory findings; the lead routes them to web-dev.

### Task A18: E2E journeys C-M1-1, U1-M1-1, G-M1-1 (qa)

**Files:** Create `apps/web/e2e/support/coaching.ts`, `apps/web/e2e/coaching.spec.ts`. Modify `apps/web/e2e/support/journey.ts` (`onboard` takes the URL it should land on, default `/`).

- [ ] **Step 1:** `support/coaching.ts`: `switchOnCoachMode(page, messages)`; `createGroup(page, messages, name)`; `createInvite(page, messages, { kind, group })` returning the link read from the read-only field; `acceptInvite(page, messages)` clicking Accept on the confirm screen and expecting `/nustatymai#treneriai`.
- [ ] **Step 2:** `coaching.spec.ts`, run by both Playwright projects (phone and desktop). Each person is its own browser context from `newDevice(browser)`, so each has its own client address (rate limits) and session:
  - **C-M1-1, U1-M1-1, G-M1-1: one group invite brings three players into "Šeštadienio grupė".**
    - Rimantas: `newOnboardedAccount(page, request, 'Rimantas Vaitkus')`, switch Coach mode on in settings, see the coach area link at home, create the group, create a group invite, keep the link.
    - Rokas (U1-M1-1, LT, signed out): open the link, land on `/prisijungti?next=...`, sign in by magic link, land on `/pradzia?next=...`, onboard as "Rokas Petrauskas", land on the confirm screen showing "Rimantas Vaitkus" and "Šeštadienio grupė", accept, see "Mano treneriai" with Rimantas.
    - Gabija (G-M1-1, already signed in): sign in and onboard first, then open the link and accept. (Google itself is covered by the feature test in Task A14; E2E has no Google.)
    - Dovydas (EN): sign in, onboard choosing English, open the link, see the confirm screen in English, accept.
    - Rimantas reloads the group page: the three display names are listed.
  - **A revoked invite:** Rimantas revokes a personal invite; a fresh player opening it sees the generic `invite.invalid` text and no Accept button.
  - **Unlink ends access (checklist 3):** after Rokas unlinks from "Mano treneriai", Rimantas's reload of Rokas's player page shows the 404 page.
  - **R-100:** with a player linked, switching Coach mode off shows `coach.stillLinked` and the player's name.
- [ ] **Step 3:** Locally: `docker compose -f infra/compose.yaml up -d`, migrate, `pnpm --filter @mychess/web test:e2e`. Expected: all pass in both projects. Report the output.
- [ ] **Step 4:** Walk persona journeys C-M1-1, C-M1-2, U1-M1-1, G-M1-1 and D-M1-1 (accept part) in `docs/personas/`; report gaps against the spec's "Done means". The "inherited group assignments" parts of U1-M1-1 and G-M1-1 are S5.

### Task A19: Security review of Part A (security-reviewer) - SECURITY

- [ ] **Step 1:** Review Part A's diff against checklist items 1-5 on #233 and decisions 1-8, 14 above. Check in particular:
  - every page under `src/app/treneris` goes through a loader that calls `requireCoach` and, for player data, `assertCoachMaySee`, and every query behind it filters on `coach_links` or the coach's own id;
  - no server action takes the acting account from the form; every id from a form or URL is parsed with zod and combined with the session account in the `where`;
  - the raw token is never stored, logged or returned after creation; the database holds only its SHA-256; tokens are 256-bit; malformed, unknown, expired, used and revoked tokens give one generic answer;
  - `acceptInvite` locks the invite and then the coach row before counting; the race tests in Task A5 fail without the lock;
  - accepting happens only by POST (server action), never on GET;
  - `returnPath` accepts only `/k/<token>`; the sign-in and onboarding redirects use it on the server; Better Auth still validates the callback URLs;
  - unlink removes memberships in the same statement (composite foreign keys); no cached grant survives unlink (`getAccount` is per request);
  - the invite page reveals the coach's display name and group name only to a holder of a valid token;
  - request paths with tokens (`/k/<token>`) appear in hosting logs: acceptable for 7-day revocable tokens? Report as advisory with a recommendation.
- [ ] **Step 2:** Report findings as blocking or advisory. The lead routes blocking ones back to the owning task's role.

### Task A20: Architect review of Part A (architect)

- [ ] **Step 1:** `mp-code-review` on Part A's diff since the commit before Task A1 (the lead names it), Standards and Spec axes. Check the package boundaries (`domain` imports only zod and chess; web reaches the database only through `@mychess/db`), the domain names against `docs/CONTEXT.md` (Coach, Coach link, Invite, Group, Player; never "student", "trainer", "membership" for a link), and that rules sit in the domain, not in actions or queries.
- [ ] **Step 2:** Report findings; the lead routes them. Part A can be pushed and deployed to staging on its own.

---

# Part B: sharing an own repertoire with a linked coach (R-42, R-96) and coach notes

**Starts only when** S3 (#253) is on `main` with its repertoire tables, its repository and its board component. The S3 names below are taken from the S3 spec (`2026-10-17-s3-repertoires-design.md`) and are **to be confirmed against S3's code** in Task B1; where S3 chose differently, use S3's names and keep the shape. Marked **[S3 TBC]**.

S3 names this part relies on, **confirmed against S3's code in Task B1 (main at aaed1e2, 2026-10-19)**. Every **[S3 TBC]** marker below resolves to these:
- table `repertoires` (`packages/db/src/schema.ts`): `id` uuid (`defaultRandom`), owner column `ownerAccountId` / `owner_account_id` (text, cascade on account delete), `side`, `name`, `version`. So Task B3's unique is `unique('repertoires_id_owner_unique').on(t.id, t.ownerAccountId)` and the share foreign key's columns are `[repertoires.id, repertoires.ownerAccountId]`.
- table `repertoire_moves`: `id` uuid, `repertoireId`, `fromKey`, `san`, `toKey`, `uci`, `comment`. Move keys come from `moveKey(fromKey, san)` in `@mychess/chess`; `parseMoveKey` is the non-throwing reader.
- table `personal_notes`: player, `repertoireId` (cascade), move key, text. The coach view must never read it (checklist 2). `packages/db/src/personal-notes.ts`: `setPersonalNote` (Result, owner-checked in its transaction), `listPersonalNotes`.
- `loadRepertoire(db, id, ownerId)` (`packages/db/src/repertoires/repository.ts`) returns `LoadedRepertoire = { repertoire: Repertoire, graph: RepertoireGraph }`: graph with move comments (R-102), **no personal notes** (they come from `listPersonalNotes`). It filters by owner, so the coach path needs a sibling loader that filters through the share join instead (Task B4 `sharedRepertoireForCoach`), reusing the private `graphRows(tx, id, side)` and `metaColumns`.
- domain `canViewRepertoire(viewer, repertoire)` and `canEditRepertoire` in `packages/domain/src/repertoire.ts` are owner-only; leave them so. The coach path goes through `canCoachSee` with the `repertoire` subject (Task A3). `COMMENT_MAX = 2000` is exported there; Task B2 uses it for `COACH_NOTE_MAX`.
- web: the board is `Board` in `apps/web/src/app/board/board.tsx`; the player's repertoire page is `/repertuarai/[id]` (`apps/web/src/app/repertuarai/[id]/`, `repertoire-screen.tsx`, header in `repertoire-header.tsx`), loaded through `ownRepertoire` in `apps/web/src/server/repertoires.ts`. "Share with coach" goes in that folder.
- latest migration: `0005_amused_galactus`; Part B's is generated as `0006_*`.
- related open work: #276 (one edit-a-repertoire module), #278 (one repertoire access scope: Part B is the first widening of who may view, so keep the share predicate in one place).

### Task B1: Confirm S3's names (lead)

- [x] **Step 1:** Read S3's merged code and fill in every **[S3 TBC]** above in this file: table and column names, the repository function names and return types, whether `loadRepertoire` returns personal notes, the board component, the repertoire page path, and S3's latest migration number. Commit the updated plan before Task B2.

### Task B2: Sharing rules in the domain (backend-dev) - SECURITY

**Files:** Create `packages/domain/src/sharing.ts`, `packages/domain/src/sharing.test.ts`. Modify `packages/domain/src/index.ts` and, if S3 has it, `canViewRepertoire`'s module.

- [ ] **Step 1: Write the failing tests:**

```ts
import { describe, expect, it } from 'vitest';
import { SHARE_REFUSALS, canShare, coachNoteSchema, COACH_NOTE_MAX } from './sharing';

const ok = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('canShare (R-42)', () => {
  it('lets the owner share an own repertoire with a linked coach', () => {
    expect(canShare('gabija', { ownerId: 'gabija' }, 'rimantas', true)).toEqual(ok);
  });
  it("refuses someone else's repertoire", () => {
    expect(canShare('gabija', { ownerId: 'rokas' }, 'rimantas', true)).toEqual(refused(SHARE_REFUSALS.notOwner));
  });
  it('refuses a coach who is not linked', () => {
    expect(canShare('gabija', { ownerId: 'gabija' }, 'dovydas', false)).toEqual(refused(SHARE_REFUSALS.notLinked));
  });
});

describe('coachNoteSchema', () => {
  it('trims and takes up to the limit', () => {
    expect(coachNoteSchema.parse(` ${'a'.repeat(COACH_NOTE_MAX)} `)).toHaveLength(COACH_NOTE_MAX);
  });
  it.each([['blank', '  ', 'coachNote.blank'], ['too long', 'a'.repeat(COACH_NOTE_MAX + 1), 'coachNote.tooLong']])(
    'refuses %s',
    (_, raw, issue) => {
      expect(coachNoteSchema.safeParse(raw).error?.issues[0]?.message).toBe(issue);
    },
  );
});
```

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `sharing.ts`:

```ts
import type { Result } from '@mychess/chess';
import { z } from 'zod';

export const SHARE_REFUSALS = {
  notOwner: 'share.notOwner',
  notLinked: 'share.notLinked',
} as const;

export interface ShareRefusal {
  readonly reason: (typeof SHARE_REFUSALS)[keyof typeof SHARE_REFUSALS];
}

/**
 * Only the owner shares, only an own repertoire, only with a linked coach
 * (R-42). The coach then sees it read-only through canCoachSee.
 */
export function canShare(
  actorId: string,
  repertoire: { readonly ownerId: string },
  coachId: string,
  linked: boolean,
): Result<undefined, ShareRefusal> {
  if (repertoire.ownerId !== actorId) return { ok: false, refusal: { reason: SHARE_REFUSALS.notOwner } };
  return linked ? { ok: true, value: undefined } : { ok: false, refusal: { reason: SHARE_REFUSALS.notLinked } };
}

/** Same limit as S3's move comments (commentSchema). */
export const COACH_NOTE_MAX = 2000;

export const coachNoteSchema = z
  .string()
  .trim()
  .min(1, 'coachNote.blank')
  .max(COACH_NOTE_MAX, 'coachNote.tooLong');
```

If S3 exports its comment limit as a constant, use it instead of `2000` **[S3 TBC]**. If S3's `canViewRepertoire(viewer, repertoire)` exists, leave it owner-only: the coach path goes through `canCoachSee` (Task A3), which already has the `repertoire` subject.
- [ ] **Step 4:** Tests pass; mutation run, no survivors.

### Task B3: Share and coach-note tables (backend-dev) - SECURITY

**Files:** Modify `packages/db/src/schema.ts`, `packages/db/test/schema.test.ts`. Create the generated migration (next number after S3's) and its snapshot.

- [ ] **Step 1: Write the failing schema tests:** a share for a coach not linked to the owner rejects (`repertoire_shares_link_fk`); a share naming a player who is not the repertoire's owner rejects (`repertoire_shares_owner_fk`); unlinking removes the coach's shares of that player and keeps the coach's notes (R-47: notes go with the repertoire); deleting the repertoire removes its shares and notes; deleting the coach's account removes the shares and notes (spec: cascades from an account).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** On S3's `repertoires` table add `unique('repertoires_id_owner_unique').on(t.id, t.ownerAccountId)` **[S3 TBC: column name]**, then:

```ts
/**
 * A player's own repertoire shared with one linked coach (R-42). The link
 * foreign key cascades, so unlinking ends every share (plan decision 2).
 */
export const repertoireShares = pgTable(
  'repertoire_shares',
  {
    repertoireId: uuid('repertoire_id').notNull(),
    playerId: text('player_id').notNull(),
    coachId: text('coach_id').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'repertoire_shares_pk', columns: [t.repertoireId, t.coachId] }),
    foreignKey({
      name: 'repertoire_shares_owner_fk',
      columns: [t.repertoireId, t.playerId],
      foreignColumns: [repertoires.id, repertoires.ownerAccountId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'repertoire_shares_link_fk',
      columns: [t.coachId, t.playerId],
      foreignColumns: [coachLinks.coachId, coachLinks.playerId],
    }).onDelete('cascade'),
    index('repertoire_shares_link_idx').on(t.coachId, t.playerId),
  ],
);

/** A coach's note on a move of a repertoire shared with them (R-42, R-47). */
export const coachNotes = pgTable(
  'coach_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coachId: text('coach_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    repertoireId: uuid('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }), // [S3 TBC: id type]
    moveKey: text('move_key').notNull(),
    text: text('text').notNull(),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    unique('coach_notes_coach_move_unique').on(t.coachId, t.repertoireId, t.moveKey),
    index('coach_notes_repertoire_idx').on(t.repertoireId),
    check('coach_notes_text_check', sql`${t.text} = btrim(${t.text}) and char_length(${t.text}) between 1 and 2000`),
  ],
);
```

- [ ] **Step 4:** `pnpm --filter @mychess/db db:generate`; review the SQL (two tables, one unique constraint on `repertoires`, nothing dropped). Tests pass; `node quality/gate.mjs check`.

### Task B4: Share and coach-note repositories (backend-dev) - SECURITY

**Files:** Create `packages/db/src/shares.ts`, `packages/db/test/shares.test.ts`. Modify `packages/db/src/coaching.ts` (`coachAccessFacts`), `packages/db/src/index.ts`, `packages/db/test/coaching.test.ts`, `packages/db/test/accounts.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `shareRepertoire(db, ownerId, repertoireId, coachId, now)` shares an own repertoire with a linked coach; refuses `share.notOwner` for another account's repertoire and `share.notLinked` for an unlinked coach; sharing twice is a no-op `ok`;
  - `unshareRepertoire(db, ownerId, repertoireId, coachId)` removes only the owner's share;
  - `repertoireShares(db, ownerId, repertoireId)` lists the coach ids it is shared with (for the checkboxes);
  - `sharedWithCoach(db, coachId, playerId)` lists the player's repertoires shared with this coach (id, name, side), and nothing once unshared or unlinked; it never lists an unshared one (checklist 2);
  - `coachAccessFacts` now returns the shared ids;
  - `upsertCoachNote(db, coachId, playerId, repertoireId, moveKey, text, now)` writes a note on a move of a repertoire shared with the coach; refuses `access.notShared` for an unshared one and `coachNote.moveNotFound` for a move key not in the repertoire; a second upsert replaces the text; `deleteCoachNote` removes only the coach's own note;
  - `coachNotesOn(db, repertoireId)` returns the notes with each coach's display name (for the owner's view and for the coach's view);
  - after unlink, the notes are still returned for the owner (R-47) and the coach's `sharedWithCoach` is empty;
  - `deleteAccount` of the coach removes the shares and notes; of the owner, the repertoire (S3 cascade) and with it the shares and notes.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** `shareRepertoire` runs in a transaction: read the repertoire's owner, check the link (`isLinked` from `coach-queries.ts`), `canShare(ownerId, repertoire, coachId, linked)`, then insert with `onConflictDoNothing()` (the composite foreign keys are the backstop). The coach-facing reads join the link every time:

```ts
/** The player's repertoires shared with this coach, through an active link (checklist 1-2). */
export async function sharedWithCoach(db: Executor, coachId: string, playerId: string) {
  const rows = await db
    .select({ id: repertoires.id, name: repertoires.name, side: repertoires.side }) // [S3 TBC]
    .from(repertoireShares)
    .innerJoin(
      coachLinks,
      and(eq(coachLinks.coachId, repertoireShares.coachId), eq(coachLinks.playerId, repertoireShares.playerId)),
    )
    .innerJoin(repertoires, eq(repertoires.id, repertoireShares.repertoireId))
    .where(and(eq(repertoireShares.coachId, coachId), eq(repertoireShares.playerId, playerId)))
    .orderBy(repertoires.name);
  return sharedRowsSchema.parse(rows);
}
```

`coachAccessFacts` fills `sharedRepertoireIds` from the same join. `upsertCoachNote` runs in a transaction that first locks the share row through the join with `.for('share', { of: repertoireShares })`, so an unshare or unlink waits for it and no note lands on a repertoire that was just unshared; then it checks the move exists in S3's moves table **[S3 TBC]** and upserts with `onConflictDoUpdate({ target: [coachNotes.coachId, coachNotes.repertoireId, coachNotes.moveKey], set: { text, updatedAt: now } })`. Returns `Result<undefined, { reason: 'access.notShared' | 'coachNote.moveNotFound' }>`.

`sharedRepertoireForCoach(db, coachId, playerId, repertoireId)` checks the joined share in one read transaction and then calls S3's loader **[S3 TBC]**, returning the graph with move comments (R-102) and **without personal notes** (checklist 2), plus `coachNotesOn`.
- [ ] **Step 4:** Tests pass; `node quality/gate.mjs check`.

### Task B5: "Share with coach" on the repertoire page (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/<S3 repertoire page>/share-with-coach.tsx` **[S3 TBC: path]**, its component test, `sharing-actions.ts`, `apps/web/test/feature/sharing.test.ts`. Modify the S3 repertoire page, both catalogues.

- [ ] **Step 1: Write the failing feature tests:** `setSharesAction(form{repertoireId, coachIds[]})` as Gabija shares with the checked linked coaches and unshares the unchecked ones; a `coachIds` entry for a coach she is not linked to changes nothing for that coach; a `repertoireId` of Rokas's repertoire changes nothing (checklist 4); signed out redirects to sign-in.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement.** The control lists `playerCoaches(getDb(), owner.id)` as checkboxes, checked from `repertoireShares(...)`, with one Save button and a `StatusLine` ("Shared with 1 coach" / "Not shared"). It shows only on the owner's own repertoire; with no linked coach it explains that sharing needs a coach (no checkboxes). The action diffs the submitted set against the current shares and calls `shareRepertoire` / `unshareRepertoire` for each change, with the owner from the session. The owner's repertoire view also shows coach notes read-only next to the move, with the coach's display name (decision for the owner, see gaps: R-42 implies the player reads them). Catalogue keys under `share`: `title`, `intro`, `noCoach`, `save`, `sharedWith`, `notShared`, `share.notOwner`, `share.notLinked`; `coachNote.byCoach`.
- [ ] **Step 4:** Tests pass; gate passes; screenshots.

### Task B6: Coach's view of a shared repertoire, with coach notes (web-dev) - SECURITY - UX

**Files:** Create `apps/web/src/app/treneris/zaidejai/[playerId]/repertuarai/[repertoireId]/page.tsx`, its view component and test, `coach-note-form.tsx` and test, `apps/web/test/feature/coach-notes.test.ts`. Modify `apps/web/src/server/coach-pages.ts` (`sharedRepertoireData`), the player page (lists `sharedWithCoach`), `apps/web/test/feature/coach-access.test.ts` (new `COACH_PAGES` row), the `treneris/actions.ts` (`saveCoachNoteAction`, `deleteCoachNoteAction`), both catalogues.

- [ ] **Step 1: Write the failing tests.** `coach-notes.test.ts`: Rimantas saves a note on a move of Gabija's shared Taimanov; Gabija's view shows it with his name; on an unshared repertoire the action returns `{ refusal: 'access.notShared' }` and writes nothing; a forged `playerId` that does not own the repertoire changes nothing. Extend `coach-access.test.ts`: add the page row `'treneris/zaidejai/[playerId]/repertuarai/[repertoireId]': (ids) => sharedRepertoireData(ids.gabija, ids.taimanov)`, and cases: a linked coach and an unshared repertoire -> `{ notFound: true }` (checklist 2); after unshare and after unlink -> `{ notFound: true }` on the next request (checklist 3); the loaded data never contains the text of Gabija's personal note on the same move (checklist 2).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `sharedRepertoireData(rawPlayerId, rawRepertoireId)`: `requireCoach()`, parse both ids, `assertCoachMaySee(coach, playerId, { kind: 'repertoire', repertoireId })`, then `sharedRepertoireForCoach(...) ?? notFound()`. The page renders S3's board read-only **[S3 TBC: component and its read-only prop]** with the move list, move comments (R-102), chapter intros, and the coach's notes; a note editor per selected move (`coachNoteSchema` at the edge). No edit controls of S3's builder appear. Player page: a "Shared repertoires" list linking to this page. Catalogue keys under `coach.shared`: `title`, `empty`, `readOnly`, `note`, `saveNote`, `deleteNote`; `coachNote.blank`, `coachNote.tooLong`, `coachNote.moveNotFound`.
- [ ] **Step 4:** Tests pass; gate passes; screenshots at both widths, both themes.

### Task B7: Lithuanian and English review, visual sign-off of Part B (i18n-content, ux-designer) - UX

- [ ] **Step 1 (i18n-content):** Review the Part B keys: share **bendrinti** (proposal; v1 had none: add it to the glossary as proposed), Coach note **trenerio pastaba**, Personal note **asmeninė pastaba**; "read-only" wording. Report each key.
- [ ] **Step 2 (ux-designer):** Review Part B's screenshots as in Task A17, in particular the read-only board on a phone and the note editor.

### Task B8: E2E journey G-M1-3 (qa)

**Files:** Create `apps/web/e2e/sharing.spec.ts`; a Taimanov PGN fixture if S3 does not already ship one (`apps/web/e2e/fixtures/taimanov.pgn`, a short game with at least one move comment) **[S3 TBC: S3's import helper and fixture]**.

- [ ] **Step 1:** `sharing.spec.ts`, both projects. **G-M1-3:** Rimantas (Coach mode on) invites Gabija by a personal invite; Gabija accepts; Gabija imports the Taimanov through S3's import flow; she opens it and shares it with Rimantas; Rimantas opens Gabija's page, sees "Taimanov" under shared repertoires, opens it read-only, sees the move comment, saves a coach note on a move; Gabija sees the note with Rimantas's name; Gabija unshares; Rimantas's reload shows the 404 page. Run the coach side in LT and Gabija's side once in LT and once in EN (switch language in settings).
- [ ] **Step 2:** Run locally; report the output. Walk persona journey G-M1-3 and U1-M1-5 (the coach cannot see Rokas's private London) and report gaps.

### Task B9: Security review of Part B (security-reviewer) - SECURITY

- [ ] **Step 1:** Review Part B's diff against checklist items 1-4: the coach reads a repertoire only through `assertCoachMaySee` with the `repertoire` subject and a query joined on `coach_links` and `repertoire_shares`; personal notes never reach any coach-facing loader or response (look at the serialized props of the coach page too, not only the rendered text); notes are written only on shared repertoires and the share row is locked while writing; unshare and unlink end access on the next request; the share action takes the owner from the session.
- [ ] **Step 2:** Report blocking and advisory findings.

### Task B10: Close the slice (lead, architect)

- [ ] **Step 1 (lead):** `node quality/gate.mjs check` and push. Expected: CI's check and e2e jobs green.
- [ ] **Step 2 (architect):** `mp-code-review` on Part B's diff; then `improve-codebase-architecture` on the slice's new files (`packages/domain/src/{coach,invite,coach-access,sharing}.ts`, `packages/db/src/{invites,coaching,groups,shares,coach-queries,invite-token}.ts`, `apps/web/src/server/{coaching,coach-pages}.ts`, `apps/web/src/lib/return-path.ts`, `apps/web/src/app/{treneris,k}/**`, the settings sections) and what they touched. The architect sends the report path and a short candidate list; the owner picks follow-ups.
- [ ] **Step 3 (lead):** Run the `retro`.
- [ ] **Step 4 (lead):** Comment on #254 with the commit ranges of Part A and Part B, the CI runs, and the security sign-off; close #254.

---

## Self-review against the spec

- **The rulings applied:** R-11/R-13 (Coach mode, no approval; access only after accepting): A1, A6, A11, A3. R-12 (invite, several coaches, groups): A2, A5, A7, A12-A14. R-39 (unlink ends access; own repertoires private): A3, A6, A15, B6. R-42/R-96 (sharing, read-only, coach notes, ends on unshare or unlink): B2-B6. R-45 (leave group, stay linked): A7, A11. R-50 (members never see each other's progress): nothing in S4 shows a member anything about another member; the player page shows only the coach's own view. R-70 (30 players, 10 groups): A1, A2, A5, A7. R-98/R-99 (two kinds, 7 days, revocable, unguessable): A2, A4, A5. R-100: A1, A6, A11. R-81 (back to the invite after onboarding): A9, A14. R-102 (comments visible to a sharing coach): B4, B6.
- **Lead decisions:** links only (no short code): A5, A12. Either side may unlink, removing groups and shares: A6, A11, A12, A4/B3 (cascades). Fork offer on unlink: not here (S5).
- **Domain:** `isCoach`, `canStopCoaching` (A1); `inviteState`, `canAccept`, `INVITE_TTL` (A2); `groupNameSchema`, `canCreateGroup` (A1); `canCoachSee` (A3); `canShare` (B2).
- **Database:** `coach_since`, `invites`, `coach_links` (pair unique, no self link), `groups`, `group_members` (A4); `repertoire_shares`, `coach_notes` (B3); cascades (A4, A8, B3); repositories (A5-A7, B4) with `acceptInvite`'s lock-and-count (A5, decision 1).
- **Web:** Coach mode switch (A11), coach area (A12, A13, B6), invite page signed out and in (A9, A14), "Mano treneriai" (A11), "Share with coach" (B5), server actions with session identity (all; A15).
- **Testing:** domain tables with mutation (A1-A3, B2); database races, single use, unlink transaction, delete cascades (A5-A8, B3-B4); feature checklist 1-5 (A14, A15, B6); E2E (A18, B8); reviews (A16, A17, A19, B7, B9).
- **Done means:** three players in "Šeštadienio grupė" through one group invite (A18); unlinked coach refused and unshared repertoire private (A15, B6); unlink ends access on the next request (A15, A18, B8); security sign-off (A19, B9); gate and CI (B10).

## Spec gaps for the owner

Not implemented; the lead asks the owner before or during the slice.

1. **Data export (R-40):** should the export include `coachSince`, the player's coaches (display names, link dates), group memberships, invites the account made, shares and coach notes written? The S1 export is unchanged by this plan.
2. **R-42 "and the player's progress on it (as if assigned)":** progress exists only from S6, so S4's coach view shows the repertoire and its comments but no progress. Confirm progress on shared repertoires lands with S7 (coach progress).
3. **CONTEXT.md, Coach note:** defined as "A Coach's note on a Move of a Repertoire they own, shown to Players they assigned it to". R-42 adds coach notes on a player's shared repertoire. The definition needs widening (architect/lead, domain-modeling skill), and the owner should confirm that the owner of the shared repertoire sees those notes (Task B5 shows them read-only, which R-42 and R-47 imply).
4. **A disabled coach's invites:** an Admin-disabled coach keeps Coach mode; their active invites can still be accepted. Refuse them (as `invite.invalid`)?
5. **Switching Coach mode off with active invites or groups:** invites become unacceptable (`invite.notCoach`) and groups stay. Revoke invites and/or delete groups instead?
6. **Coach note length:** this plan reuses S3's 2,000-character comment limit.
7. **Personal invite with a group:** the plan allows a personal invite to name a group (decision 10). Confirm.
8. **Glossary proposals** from Tasks A16 and B7 (personal invite, group invite, revoke, share).
