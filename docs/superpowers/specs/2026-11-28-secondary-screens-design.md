# Secondary screens (#381, part 6)

Issue #381, sub-project 6 of 6 (order in
`2026-11-25-app-shell-and-visual-refresh-design.md`). Parts 1 to 5 are on
main. This spec restyles the remaining screens to the Ocean style and fixes
what the ux-designer audit of 2026-11-28 found: Settings (`/settings`,
including My coaches), the account menu, Opponents (`/fide`), sign-in
(`/sign-in`), onboarding (`/welcome`), the invite page (`/invite/[token]`),
the missing app 404 and error pages, and one leftover in part 5's Invite a
player sheet.

The scope is **restyle, fix and surface** (owner, 2026-11-28), as in part 5:
the screens keep their capabilities and show facts the app already has.
Opponent search by name, recent searches and links from an opponent's
openings to the player's repertoire are not in this part.

## Audit findings this spec answers

From the ux-designer audit (390x844, 375x667, 1280x800, 1440x900, both
themes; Gabija with two coaches, the coach Rimantas, throwaway accounts since
deleted):

Settings
1. The page is about 2,530px tall at every width.
2. Delete account is always open (about 600px, a filled red button).
3. Three full-width primary buttons (Profile Save, Training Save, Coach
   mode); at 390 Training Save loads under the tab bar.
4. Every desktop field is 926px wide.
5. My coaches starts at y=1116 (390), below Coach mode.
6. My coaches: Unlink is not in the error tone; Unlink and Leave group are
   aligned differently; rows are plain text; a row does not say what the
   coach gives the player.
7. After accepting an invite the `#coaches` heading lands under the sticky
   top bar.
8. An account with no coach sees an empty My coaches with nothing to say.
9. Phone sections are divided by rules, unlike the soft cards of parts 2-5.
10. The back link always goes to Today.

Account menu
11. On a phone it is a top-right dropdown, out of thumb reach.
12. Sign out is an outlined button among plain rows; no dividers; the
    sign-in email is not shown.
13. Dark: the selected theme fill is barely visible (part 5 finding 15).

Opponents
14. The tab says "Opponents", the h1 "Opponent's games".
15. The empty state is only the form.
16. On a phone the field error shows below the Search button, about 150px
    from the field.
17. (Name search, links to the repertoire: new capability, out of scope.)
18. Results were reviewed from code only: they need a screenshot pass with
    the local Lichess fixture data.

Sign-in, welcome, invite
19-20. Sign-in is good; the wordmark is accent on sign-in and welcome but
    fg in the top bar.
21. From an invite, sign-in says "the coach's invite" without a name.
22. A first-time visitor gets no line saying what mychess is.
23. Welcome's Delete account link opens a second card with other padding and
    the page jumps from centred to top-aligned.
24. Welcome does not mention the waiting invite.
25. The invite page is top-left with no card and no wordmark, unlike
    sign-in and welcome.
26. Its h1 is "Invite from a coach" in every state.
27. The privacy text is a 7-line paragraph at 390.
28. Not valid and own invite are plain text with a bare underlined Home
    link; own invite should lead back to Coach.
29. After Accept the player lands on Settings, not on Today where the new
    assignment waits.
30. A group invite does not say what the group comes with.
31. Expired, used and revoked read the same (kept, plan decision 6 of the
    invite plan).

Missing pages
32. No app 404: Next's default unstyled page, no shell, no way home.
33. No root error page; no loading states for Settings, Opponents, invite.

Part 5 leftover
34. Two open personal invites from the same day read the same in the
    Invite a player sheet; two Revoke confirmations can be open at once.

## Rulings applied

New, given by the owner in this brainstorm (recorded in
`docs/owner-rulings.md`):

- **R-234:** Accepting a coach's invite lands the player on Today with a
  one-time notice "You are linked with <coach>" (and the group's name for a
  group invite). My coaches stays reachable from the account menu.
- **R-235:** An invite link names its coach (display name) and, for a group
  invite, the group's name to a visitor who is not signed in, on the sign-in
  page reached from the link. Nothing about the coach's players is shown.
  An invalid link shows no name.
- **R-236:** The signed-in confirm page of a group invite lists the
  repertoires currently assigned to that group, each with its deadline,
  before the player accepts. Not shown to signed-out visitors.
- **R-237:** My coaches is always shown in Settings and the account menu,
  for every account; with no coach it says that a coach links with you by
  sending an invite link.

Kept: explicit Save buttons per section (no save on change). Unchanged and
applied: R-12, R-81, R-90, R-98, R-99, R-217 to R-233.

## Lead decisions

- **Settings is one page** (owner chose layout A): soft cards, most used
  first. No sub-pages, no desktop section nav.
- **Settings' back link** goes to the tab the account menu was opened from:
  the menu adds `?from=` with one of today, repertoires, opponents, coach;
  anything else, or none, goes to Today.
- **The post-accept notice** is carried by `/?linked=<coachId>`; Today shows
  it only when the signed-in player holds a live link with that coach (the
  coach's name comes from that link, never from the URL), and a reload
  without the parameter drops it.
- **The account menu is a bottom sheet on a phone** (the part 4/5 `Sheet`),
  a dropdown on desktop.
- **Delete account** (Settings and welcome) opens a sheet on a phone and a
  dialog on desktop, with today's confirmation unchanged.
- **One entry frame** for sign-in, welcome and the invite page: a centred
  soft card under the wordmark; the wordmark is `fg` everywhere, matching
  the top bar.

## Settings (`/settings`)

- **Header:** `PageHeader` "Settings", parent from `?from=` (lead decision).
- **Cards, in order:**
  1. **Training:** new moves a day, reviews a day, "Show arrows when
     learning new moves" (R-205), Save.
  2. **My coaches:** one row per coach: the coach's name, then each of that
     coach's repertoires assigned to the player (direct or through a group)
     with the shared `AssignmentStatus` line of part 5, then the groups with
     Leave group. Unlink (one per coach) and Leave group are error-tone
     buttons, both right-aligned on desktop and full rows on a phone, each
     with its existing confirmation. Empty (R-237): "No coach yet. A coach
     links with you by sending an invite link." Anchor `#coaches` with a
     scroll margin of the top bar height plus 16px.
  3. **Account:** display name with Save; the sign-in methods (email,
     Google, Lichess) as today, with the Lichess unlinked notice (R-90).
  4. **Coach mode:** one line saying what it does and its switch button
     (secondary).
  5. **Your data:** Download my data; "Delete account..." as an error-tone
     row opening the delete sheet or dialog.
- **Buttons:** every Save is secondary, sized to its label at the start of
  the card's last row; after a save a "Saved" status line shows beside it.
  No primary button on the page.
- **Width:** content column 640px on desktop; text fields up to 360px,
  number fields 128px.

## Account menu (`shell/account-menu.tsx`)

- Phone: the avatar opens a bottom sheet; desktop: the dropdown stays.
- Contents, top to bottom: display name and the sign-in email (muted);
  divider; Settings; My coaches (to `/settings#coaches`); Theme (system,
  light, dark); divider; Sign out as a plain row.
- The selected theme: `accent-subtle` fill with an `accent` ring, as part
  5's radio cards, in both themes.
- Settings and My coaches links carry `?from=` (lead decision).

## Opponents (`/fide`)

- h1 "Opponents", matching the tab.
- The field error shows directly under the field, above the hint.
- Empty state under the form: a short explanation of what a search shows
  (an opponent's broadcast games grouped by colour and opening, with the
  results) as muted text in a soft card.
- Results: a screenshot pass with the local Lichess fixture data
  (`FIDE_DUMP_FIXTURE_DIR`) on, at the four sizes and both themes, and the
  Ocean card style where the pass finds a mismatch. No name search, no
  recent searches, no repertoire links.

## Entry frame: sign-in, welcome, invite

Shared: a centred soft card (32px padding) under the `fg` wordmark,
vertically centred on desktop, top-aligned with 24px above on a phone; the
layout does not jump when content opens inside it.

### Sign-in (`/sign-in`)

- Under the wordmark, one line saying what mychess is.
- Reached from an invite (`?next=/invite/<token>`) with a valid invite
  (R-235): "<Coach> invited you to <group>. Sign in to accept." (personal:
  "<Coach> invited you to train with them. Sign in to accept."). Invalid,
  expired, used or revoked: the generic line, no name.
- **SECURITY:** the signed-out preview is a new unauthenticated read by a
  bearer token. It reads only the coach's display name and the group's
  name of a valid invite, through the same token hash lookup as the invite
  page (a 43-character random token, too long to guess, so no extra rate
  limit, as the invite page has none), and logs no token. Review by the
  security-reviewer.

### Welcome (`/welcome`)

- Delete account is a quiet text link under the card opening the delete
  sheet or dialog (no second card, no layout jump).
- When `?next=` is an invite: "Next: the invite from <coach>." under the
  form, with the same rules as sign-in's preview.

### Invite (`/invite/[token]`)

- Same frame. The h1 per state: confirm "<Coach> invites you" (group:
  "<Coach> invites you to <group>"); accepted "You are linked with
  <Coach>"; not valid "This invite link is not valid"; own invite "This is
  your own invite".
- Confirm: the privacy facts as a three-item list (what the coach will see,
  what stays private, that you can unlink any time from Settings); a group
  invite lists "Comes with" and each currently assigned repertoire with
  its deadline (R-236), or nothing when the group has none; Accept
  (primary) and Not now (quiet link to Today).
- Accept redirects to Today with the R-234 notice (`/?linked=<coachId>`).
- Not valid: the StatusLine in error tone, "Ask your coach for a new
  link.", and a secondary "Go to Today". Own invite: an info StatusLine and
  "Back to Coach".

## Today: the linked notice

- With `?linked=<coachId>` and a live link with that coach, Today shows a
  dismissable success StatusLine at the top: "You are linked with <coach>"
  (group invite: "...through <group>", when the link came through a group).
  Otherwise nothing.

## Missing pages

- **`app/not-found.tsx`:** inside the shell (signed in) or the entry frame
  (signed out): "Page not found", one line, and "Go to Today".
- **`app/error.tsx` and `app/global-error.tsx`:** "Something went wrong",
  a Try again button (reset) and "Go to Today"; no error detail shown.
- **`loading.tsx`** for `/settings`, `/fide` and `/invite/[token]`: card
  skeletons in the page's layout.

## Invite a player sheet (part 5 leftover)

- Each open personal invite shows its made time with the minute ("made 28
  Nov, 14:05 · expires 5 Dec"), in the user's time zone.
- Opening one Revoke confirmation closes any other.

## Domain and data

- **Invite preview read** (`invitePreview(token)`): coach display name and,
  for a group invite, the group name, for a valid invite only; nothing for
  an invalid one. Used by sign-in, welcome and the invite page.
- **Group invite's assignments** (R-236): the group's current assignments
  (repertoire name, deadline) for the invite page, read only for a valid
  group invite and a signed-in viewer.
- **My coaches rows:** the player's assignments grouped by coach, from the
  assignment reads that exist.
- **Linked notice:** a check that the signed-in player holds a live link
  with the given coach, returning the coach's name and the group if any.
- Any new read gets db tests; whether the player may see a group's
  assignments before joining is decided in `packages/domain` as an invite
  rule.

## Testing

- Components: Settings cards and their order; My coaches with assignments,
  groups, empty state, error-tone actions; Save "Saved" status; delete
  sheet and dialog; account menu (sheet on phone, contents, selected theme,
  `from`); Opponents error placement and empty state; sign-in with a valid
  and an invalid invite preview; welcome with an invite; invite page per
  state, privacy list, group "Comes with"; Today's linked notice (valid,
  wrong coach, no link); not-found and error pages; invite sheet times and
  one open confirmation.
- db: the invite preview (valid, expired, used, revoked, unknown), the group
  assignments for an invite, the linked-notice check.
- E2E: a signed-out invite journey (link, sign-in naming the coach, accept,
  Today notice, the assignment on Today); Settings delete through the sheet
  on Pixel 7; the 404 page.
- ux-designer: sign-off at 390x844, 375x667, 1280x800 and 1440x900 in light
  and dark, including the Opponents results with the fixture data.
- security-reviewer: the signed-out invite preview and the group
  assignments shown before accepting.

## Acceptance

- Every audit finding above, except 17 and 31 (out of scope or kept), is
  answered as this spec says, at phone and desktop width in both themes.
- R-234 to R-237 are in `docs/owner-rulings.md`.
- Gate green, E2E green on desktop and Pixel 7, ux-designer and
  security-reviewer signed off.
