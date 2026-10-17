# S4 Coaching links: design

Issue #254 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S4, as reshuffled by R-96.
Brainstormed with the owner on 2026-10-17. Needs S1 (done). The sharing part needs S3's repertoires.

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-11, R-13 | Every account is a player. "Coach" is a capability anyone can switch on, with no approval. A coach sees only players who accepted |
| R-12 | A coach links a player through an invite the player accepts. A player may have several coaches. Coaches can group players |
| R-39 | Unlinking ends the coach's access immediately. A player's own repertoires are private unless shared |
| R-42, R-96 | A player shares an own repertoire with chosen linked coaches. They see it and its comments (R-102) and can add coach notes, but cannot edit it. Sharing ends on unshare or unlink |
| R-45 | A player can leave a group and stay linked. What that does to assignments comes in S5 |
| R-50 | Group members never see each other's progress. Member lists and group threads are M2 |
| R-70 | Free entitlement: at most 30 linked players and 10 groups per coach |
| R-98, R-99 | A personal invite (single use) and a group invite (multi-use, within the player limit). Both are unguessable, revocable, and valid for 7 days |
| R-100 | Switching the coach capability off is refused while any player is linked |

The security checklist on #233, items 1 to 5, is part of this spec's acceptance.

## Lead decisions

- **Invites are links only in M1.** R-12 allows "link or code"; a typed short code would need its own rate limiting.
- **Either side may unlink.** Unlinking also removes the player from that coach's groups and ends every share with that coach.
- **The fork offer on unlink is S5 (R-96).** In S4 there are no assignments yet to fork.

## Design

### Domain (`packages/domain`)

- `Coach` capability: `isCoach(account)` (it has `coachSince`) and `canStopCoaching(linkCount)` (R-100).
- **Invites:**
  - `inviteState(invite, now)` returns `active`, `expired`, `used` or `revoked`.
  - `canAccept(invite, player, coach, counts, now)` gives a refusal value for each of these:
    - expired, used or revoked;
    - the coach's own invite;
    - the coach at 30 players;
    - the coach no longer a coach.
  - `INVITE_TTL` is 7 days.
- **Groups:** `groupNameSchema` (trimmed, 1 to 60 characters) and `canCreateGroup(count)`, at most 10.
- **The access rule,** `canCoachSee(coach, player, subject, facts)`: allowed only with an active Coach link. Subject `profile` (the display name) is allowed with the link alone. Subject `repertoire` is allowed only when it is shared with this coach (S5 adds assigned ones). Each refusal has a reason. Every coach-facing query calls it, and the queries also join on `coach_links` (checklist 1 to 4).
- **Sharing:** `canShare(owner, repertoire, coach, linked)`. Only the owner can share, only an own repertoire, and only with a linked coach.

### Database (`packages/db`)

- **Accounts:** `accounts.coach_since` (nullable).
- **Invites table:** `invites` holds:
  - the coach;
  - the kind (personal or group);
  - the group (nullable);
  - the token hash (unique);
  - the expiry, revoked and created times;
  - the used time and the account that used it (personal invites only).
- **Link and group tables:**
  - `coach_links` (coach, player, created). The coach and player pair is unique, and a coach cannot link to themselves (CHECK).
  - `groups` (coach, name).
  - `group_members` (group, player). The primary key is the pair. The repository only adds members who are linked.
- **Shares and notes:**
  - `repertoire_shares` (repertoire, coach). The pair is unique.
  - `coach_notes` (coach, repertoire, move key, text).
- **Cascades:**
  - from an account (S1 delete) to all of the above;
  - from a coach link, through the repository's unlink transaction, to that coach's group memberships and shares.
- **Repositories, all transactional:**
  - `createInvite` returns the raw token once and stores only its SHA-256 hash.
  - `acceptInvite(tokenHash, player, now)`. It locks the invite row and counts the coach's links in the same transaction, so two accepts can never exceed 30 players or use a personal invite twice.
  - `revokeInvite`, `unlink(coach, player)` and `leaveGroup`.
  - Group create, rename, delete and add or remove member.
  - `shareRepertoire` and `unshare`, and coach-note upsert or delete.
  - `coachPlayers(coach)`, `playerCoaches(player)` and `sharedWithCoach(coach, player)`. Each one filters on an active link.

### Web (`apps/web`)

- **Settings:** a "Coach mode" switch. When switching off is refused, it shows the players to unlink first.
- **Coach area, `/treneris`:**
  - players (display name, groups, unlink);
  - groups (create, rename, delete, members);
  - invites (create a personal or group invite, copy the link, see its state, revoke);
  - a player's shared repertoires, read-only on the S3 board, with coach notes.
- **Invite page, `/k/[token]`:**
  - **Signed out:** sign in, then come back here after onboarding (R-81).
  - **Signed in:** a confirm screen with the coach's display name and the group, if any.
  - **On accept:** the player lands on "Mano treneriai".
  - **Refusals** are catalogue messages that do not reveal more than needed: one generic "this invite is not valid" for expired, used, revoked or unknown tokens.
- **Player:** a "Mano treneriai" section in settings lists linked coaches, with unlink and leave group. The repertoire page gets a "Share with coach" control, with the linked coaches as checkboxes.
- **Server actions** authenticate, load, call the domain rule and save. A `playerId` or `coachId` sent by the client is never trusted; the coach is always the session account (checklist 4).

## Testing

- **Domain:** tables of cases for `inviteState`, `canAccept`, `canCoachSee` and `canShare`, with mutation testing.
- **Database:**
  - two parallel accepts at 29 linked players create exactly one link;
  - a personal invite is used once;
  - unlinking removes group memberships and shares in one transaction;
  - the S1 delete cascades.
- **Feature tests** (the #266 harness):
  - every coach route and action refuses an unlinked coach (checklist 1), a linked coach reading an unshared repertoire (checklist 2), and access after unlink (checklist 3);
  - a forged `playerId` is ignored (checklist 4);
  - expired, reused and revoked tokens fail, and a coach cannot accept their own invite (checklist 5).
- **E2E (Playwright):**
  - the coach persona creates a group invite for "Šeštadienio grupė";
  - three players accept it (C-M1-1, U1-M1-1; G-M1-1 already signed in with Google);
  - Gabija shares her Taimanov, then unshares it (G-M1-3);
  - each runs on a phone and on desktop, in LT and EN.
- **Reviews:** security-reviewer signs off checklist items 1 to 5. ux-designer and i18n-content review the new screens.

## Done means

- The coach persona invites three players into "Šeštadienio grupė" through one group invite, and each player appears in the group.
- Every coach route refuses an unlinked coach, and an unshared repertoire stays private (tests).
- Unlinking ends access on the next request.
- Security-reviewer signs off. The gate and CI are green.
