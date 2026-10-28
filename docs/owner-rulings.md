# Owner rulings

Answers the owner gave during the v2 domain grilling, issue #226, all dated 2026-10-16. Each ruling cites its question number (Q-n). These are authoritative: where code, a spec or a plan disagrees with a ruling, the ruling wins until the owner changes it. New rulings get the next free R-number; superseded rulings are struck through and point to their replacement, never deleted.

Domain vocabulary is defined in [CONTEXT.md](CONTEXT.md); architecture decisions derived from these rulings are in [adr/](adr/).

## Product & scope

- **R-1** (Q1, #226, 2026-10-16): The UI is Lithuanian and English from day 1, Lithuanian is the default. Opening names come from the šachmatai.lt taxonomy.
- **R-2** (Q7, #226, 2026-10-16): Tiers (0-1400, 1400-2000, 2000+) are QA personas plus soft product defaults (suggested depth, starter repertoire). No feature is gated by tier.
- **R-3** (Q8, #226, 2026-10-16): The MVP is free. The code keeps an entitlement seam so coach subscriptions can be added later.
- **R-4** (Q10, #226, 2026-10-16): Content sources are PGN import, a board-based builder, a Lichess explorer panel, and starter repertoires per tier.
- **R-5** (Q11, #226, 2026-10-16): One MVP delivered in three milestones. Real testers start after M1.
  - **M1 Core loop**: auth, coach invite + groups, PGN import, board builder, assign, FSRS learn/review, basic coach progress.
  - **M2 Coaching**: weak spots, activity, goals, notes, messaging/notifications, explorer, starter repertoires.
  - **M3 Ecosystem**: game import + deviation, FIDE/LSF/tournaments.
- **R-6** (Q13, #226, 2026-10-16): v1 is frozen (no more deploys). v2 gets fresh Vercel and database infrastructure. v1 users are migrated later only if any turn out to be real.
- **R-7** (Q35, #226, 2026-10-16): Mobile-first responsive web, installable as a PWA. Drilling is online-only in the MVP; offline is post-MVP.
- **R-8** (Q36, #226, 2026-10-16): Starter repertoires are drafted per tier by chess-dev from Lichess explorer statistics, approved by the owner (or a trusted coach), and stored as PGN seed data.
- **R-9** (Q38, #226, 2026-10-16): A minimal owner admin: users (disable), starter repertoire publishing, integration import triggers, usage stats, and an audit log.
- **R-10** (Q39, #226, 2026-10-16): "mychess" is a working name. Brand and domain are decided before the production launch.

## Coach-player

- **R-11** (Q25, #226, 2026-10-16): One account type. Every account is a player; "coach" is a capability switched on. A coach can train and can have their own coach.
- **R-12** (Q2, #226, 2026-10-16): A coach links a player through an invite link or code that the player accepts. A player may have several coaches. Coaches can group players. Clubs are post-MVP.
- **R-13** (Q34, #226, 2026-10-16): Anyone may become a coach, with no approval. If a FIDE ID is linked, the FIDE title and trainer title are shown as badges. A coach has access only to players who accepted.
- **R-14** (Q4, #226, 2026-10-16): Coach monitoring in the MVP covers drill progress per line, activity/streaks, weak spots, and real games vs repertoire (OpeningTree-style deviation).
- **R-15** (Q5, #226, 2026-10-16): Coach actions in the MVP: assignments with optional deadlines, per-move notes, training goals, messaging and notifications.
- **R-16** (Q31, #226, 2026-10-16): A group assignment is inherited by current and future group members. Leaving the group removes it, unless the player was also assigned it individually. The effective deadline is the later of the group deadline and the player's join date.
- **R-17** (Q32, #226, 2026-10-16): Both coach and player can set goals. Kinds: habit, mastery (a line or chapter by a date), results (no deviations in the next N games). Goals set by a coach are tracked on the coach dashboard.
- **R-18** (Q33, #226, 2026-10-16): Messaging has 1:1 threads, group threads, and comment threads on moves/positions. Notifications are in-app plus a daily email digest (opt-out). Web push is later.

## Repertoire & training

- **R-19** (Q27, #226, 2026-10-16): A repertoire is for one side (White or Black) and is divided into chapters by opening. It is a position-keyed graph, so transpositions merge. A player may have several repertoires per side.
- **R-20** (Q3, #226, 2026-10-16): Assignment is live-linked by default; the player may fork it into a personal copy. Players can also build their own repertoires.
- **R-21** (Q28, #226, 2026-10-16): On a live-linked repertoire the player may add private personal notes only. Changing or adding moves requires a fork.
- **R-22** (Q6/Q15, #226, 2026-10-16): Scheduling is FSRS (ts-fsrs) per repertoire move, preceded by a learn pass (arrows, then a blind retest, as in v1). Free play against the repertoire is a second mode. Progress is reconciled when the repertoire changes.
- **R-23** (Q29, #226, 2026-10-16): When a coach edits a live repertoire, progress is reconciled: unchanged moves keep their progress; new moves go to the "to learn" queue; removed moves leave review; a changed move starts fresh. The player gets a "coach updated" notice.
- **R-24** (Q30, #226, 2026-10-16, M3): Real-game deviation. A player mistake makes that move due now (an FSRS lapse) and is flagged on the coach dashboard. An opponent leaving book produces a suggestion to add a line from the explorer.

## Integrations

- **R-25** (Q9, #226, 2026-10-16): MVP integrations: FIDE ID + rating, Lichess/Chess.com account linking, LT tournaments (chess-results.com), LSF (Lithuanian Chess Federation) ratings. Delivered in M3 per R-5.
- **R-26** (Q37, #226, 2026-10-16): Sign-in with email magic link, Google, and Lichess OAuth (which also links the Lichess account).
- **R-27** (Q40, #226, 2026-10-16): Email via Resend on staging/production (Vercel Marketplace), Mailpit locally.

## Platform & factory

- **R-28** (Q12, #226, 2026-10-16): Tag the last v1 main `v1-final`; one commit moves v1 into `archive/v1/`, excluded from build/lint/CI; v2 lives at the repo root; no history rewrite.
- **R-29** (Q14, #226, 2026-10-16): Port from v1, re-implemented with tests: opening data, LT names, generators, taxonomy, LT chess terminology; chess core (PGN parser, board wrapper, pieces/themes); integrations (FIDE, chess-results scraper, Lichess/Chess.com OAuth) when M3 starts. Leave archived: Stockfish analysis, gamification, Google Drive picker.
- **R-30** (Q16, #226, 2026-10-16): Stack as sportbet_new: pnpm monorepo, Next.js 16 in `apps/web`, `packages/{domain,chess,db}`, Drizzle, Neon Postgres, Auth.js (magic link + Google); the sign-in library is now Better Auth (ADR 0010, S1).
- **R-31** (Q17, #226, 2026-10-16): Ten technical agent roles plus the lead: architect, backend-dev, web-dev, qa, security-reviewer, devops, chess-dev, ux-designer, i18n-content, integrations-dev.
- **R-32** (Q18, #226, 2026-10-16): Personas live in `docs/personas/`, with seeded staging accounts and E2E fixtures carrying tier-matched repertoires, plus four persona subagents that explore staging in character each milestone.
- **R-33** (Q19, #226, 2026-10-16): Use the sportbet quality kit. CI enforces the full gate including mutation testing; the post-edit hook stays on; the Stop hook runs a fast gate (no mutation).
- **R-34** (Q20, #226, 2026-10-16): Trunk-based, lead-only commits. Green CI deploys to staging; production is promoted manually by the owner. Unattended runs only for issues labelled both `size/small` and `auto-ok`.
- **R-35** (Q21, #226, 2026-10-16): GitHub-hosted runners; Vercel staging and production; a Neon branch per environment.
- **R-36** (Q22, #226, 2026-10-16): Decision records are `docs/CONTEXT.md`, `docs/adr/` (domain-modeling skill) and `docs/owner-rulings.md`, mirrored on GitHub.
- **R-37** (Q23, #226, 2026-10-16): Full label taxonomy: `epic`, milestones M1/M2/M3, `size/*`, `area/*`, `persona/*`, `role/*`, `auto-ok`, `blocked`. v1 custom labels are removed.
- **R-38** (Q24, #226, 2026-10-16): The global skills (as in sportbet) are listed as prerequisites; `retro` and `writing-for-agents` are vendored into `.agents/skills` with `skills-lock.json`.

## Privacy

- **R-39** (Q26, #226, 2026-10-16): A coach sees everything about the repertoires they assigned, plus the player's imported games. The player's own repertoires are private unless shared. Unlinking ends the coach's access immediately.
- **R-40** (Q41, #226, 2026-10-16): GDPR: data export (PGN + JSON) and hard delete. On unlink the coach loses access, the player keeps their progress and is offered a fork.
- **R-41** (Q8, #226, 2026-10-16): Encryption at rest of repertoires (a v1 feature) is dropped.

## M1 grilling (#233, 2026-10-16)

The open questions from the kickoff, answered by the owner. Q-numbers refer to the numbered items on #233.

### Coach-player
- **R-42** (Q3): Sharing a player's own repertoire is per coach: the chosen linked coaches see it and the player's progress on it (as if assigned) and can add coach notes, but cannot edit it. Sharing ends on unshare or unlink.
- **R-43** (Q4): A fork carries the player's training progress. The fork is the player's own repertoire, private unless shared; the coach sees that their assignment was forked, not the fork's content.
- **R-44** (Q5): Unlink with the fork declined or ignored: the live repertoire disappears from the player's account, the review state stays dormant (it is per position, so it returns if the same moves come back), and the fork offer stays open for 30 days.
- **R-45** (Q6): Leaving a group (while staying linked) is treated like unlink for that group's assignments (R-44).
- **R-46** (Q18): A player can pause an assignment: it stays assigned but leaves their reviews and learn queue; the coach sees it as paused. Unpause any time.
- **R-47** (Q22): After unlink, coach notes on the player's moves go with the repertoire (a fork keeps them read-only); goals the coach set end; the 1:1 thread stays readable for both but closes for new messages; the coach keeps their own private notes about the player.
- **R-48** (Q23): A linked coach sees all games the player imported, past and future; the player can hide individual games from coaches.
- **R-49** (Q25): When a coach deletes their account, every player with an assignment from them gets an automatic personal fork (progress and coach notes read-only), is notified, and then the coach's data is hard-deleted.
- **R-50** (Q26): Group members see each other's display names and messages in the group thread only; never each other's progress, games or ratings.
- **R-51** (Q12): A passed deadline marks the assignment overdue for the player and on the coach dashboard, with a notification to both (in-app + digest). Nothing is blocked; the coach can extend or clear it.
- **R-52** (Q13): A coach's edits to a live repertoire produce one batched notification per repertoire per day to every player who has it (including via groups), summarising the change, with an optional coach note.

### Repertoire & training
- **R-53** (Q7, Q8): Review state belongs to the player + position + move: a move present in several of the player's repertoires is one review card, and positions merge across chapters and repertoires. Chapter stats count every move that appears in the chapter.
- **R-54** (Q17): When a player's repertoires give different answers in the same position, each review is shown inside one repertoire and expects that repertoire's move; the player and coach see a "two answers" notice; nothing is blocked.
- **R-55** (Q9): A new move is learned after one correct blind retest in the learn pass (a wrong answer repeats the arrow step); then its first FSRS review is scheduled. Free play does not change FSRS state; its mistakes count as weak-spot data.
- **R-56** (Q10): Mastered (line or chapter) = every move learned and FSRS retrievability >= 90% today. Weak spot = a move with 2+ lapses in the last 30 days or retrievability < 70%, ranked by lapses. Thresholds are tunable constants.
- **R-57** (Q11): A results goal ("no deviations in the next N games") is broken only by player mistakes, not by the opponent leaving book.
- **R-58** (Q19): A player can mark a move, line or chapter "I know this": it skips the learn pass and goes to FSRS review (first review tomorrow). The coach sees skipped moves.
- **R-59** (Q30a): After a lapse the correct move is shown with an arrow and the player must play it before continuing; the lapse is recorded once.
- **R-60** (Q30b): Review results that fail to save queue locally and retry in the background; the drill continues; a banner shows unsynced results.
- **R-61** (Q30c): Review has a hint button (highlights the piece to move); using it counts as a lapse (FSRS Again).
- **R-62** (Q30d): A review session ends after 20 due moves by default (player setting 10-100) with a "continue" option; new moves to learn have a separate daily limit (default 10).
- **R-63** (Q31a): An imported game's chapter is named from the šachmatai.lt taxonomy by classifying its moves; otherwise v1's header rule (unique Event, White or Black); otherwise "Chapter N". The uploader can rename.
- **R-64** (Q31b): A PGN upload imports every valid game and skips broken ones, listing them (game number and reason) before the user confirms. A file with no valid game is refused.
- **R-65** (Q31c): `[%cal]` and `[%csl]` arrows and circles are kept as annotations on moves and shown in the learn pass and when browsing.
- **R-66** (Q31d, e): A comment before a game's first move becomes the chapter's intro text. Upload limits: 2 MB, 200 games, variation depth 64; above that the upload is refused, naming the limit.

### Integrations, accounts and platform
- **R-67** (Q1): "LSF rating" is a Lithuania ranking built from FIDE's monthly list filtered to federation LTU (rank by standard, rapid and blitz), shown next to the FIDE rating. LSF publishes no rating of its own (#232).
- **R-68** (Q2): Lichess sign-in ships in M1 (with magic link and Google) and also links the account. Chess.com is never a sign-in method, only a linked username for game import.
- **R-69** (Q24): One account per canonical email: a Google sign-in with a verified email joins the existing account. Lichess is linked only from settings while signed in, never merged by email.
- **R-70** (Q14): Every account has a "free" entitlement with limits enforced in the domain (coach: up to 30 linked players and 10 groups). No paywall in the MVP.
- **R-71** (Q15): Before the M1 production launch the lead counts v1 accounts with real activity and shows the owner, who decides then whether to invite them; no data migration is built unless asked.
- **R-72** (Q20, Q27): Admin is a flag set only by a seed or CLI script, initially for the owner. Only Admins approve and publish starter repertoires.
- **R-73** (Q21, Q28): Persona accounts sign in on staging through a test-only route that exists only when a staging env flag is set, accepts only `@mychess.test` emails and requires a shared-secret header; a test proves production refuses it.
- **R-74** (Q29): The Lithuanian terms proposed in `docs/glossary-lt.md` are adopted.
- **R-75** (Q32): Unattended backlog runs open a PR with the gate green; the next supervised lead session reviews (qa, architect) and merges.
- **R-76** (S2 brainstorm, #252, 2026-10-16): FSRS target retention is 90%, fixed for every player in M1; a player setting can follow later without data changes.
- **R-77** (S2, #252, 2026-10-16): Lithuanian opening names from šachmatai.lt get a safe tidy only in the generator: collapse whitespace, castling as O-O, a comma before a trailing move qualifier, no space after a move number. Wording, capitalisation and word forms stay verbatim.
- **R-78** (S2 review, #252, 2026-10-16): A lapse or hint on a move keeps the standard FSRS relearning step: the move comes back within minutes the same day until it sticks, and these repeats count toward the session size (R-62).
- **R-79** (#260, 2026-10-16): A line ends at a leaf or at a move that returns to a position already on it; that move belongs to the line, so it is trained and counts for mastery. The main line follows the first move added at each position.
- **R-80** (S1 brainstorm, #251, 2026-10-16): A sign-in lasts 90 days and is renewed on every visit; sessions are stored in the database, so disabling or deleting an account ends them at once.
- **R-81** (S1 brainstorm, #251, 2026-10-16): First sign-in asks only for the display name (prefilled from Google or Lichess when available) and the language (LT default); everything else is optional later. An invite link continues to its group after this screen.
- **R-82** (S1 brainstorm, #251, 2026-10-16): Account deletion shows what will be deleted and offers the data export first; the player confirms by typing their display name; deletion is immediate and irreversible, with a confirmation email afterwards.
- **R-83** (S1 planning, #251, 2026-10-16): Lichess sign-in asks Lichess for the email (`email:read` scope). A first Lichess sign-in whose email already belongs to an account is refused, telling the player to sign in another way and link Lichess from settings (never merged, R-69); otherwise it creates the account with that email.
- **R-84** (S1 close, #251, 2026-10-17): Linking Google or Lichess from settings needs a sign-in within the last day, as unlinking does.
- **R-85** (S1 close, #251, 2026-10-17): A new account starts in the language the person was using when they asked for the magic link or signed in with Google or Lichess; Lithuanian when that is unknown. Onboarding can change it.
- **R-86** (S1 close, #251, 2026-10-17): An account that has not finished onboarding can delete itself, confirming by typing its email address instead of the display name.
- **R-87** (S1 close, #251, 2026-10-17): A Google sign-in with a verified email proves the mailbox like a magic link: if the account with that email is unproven (created by Lichess), its unproven access ends (provider links and sessions) and Google joins it.
- **R-88** (S1 close, #251, 2026-10-17): Admin audit rows keep the target account id but store a one-way hash of the email, not the address.
- **R-89** (S1 close, #251, 2026-10-17): The data export includes the account's active sessions (IP address, user agent, created and expiry times), never their tokens.
- **R-90** (S1 close, #251, 2026-10-17): When proving the email ends an unproven account's Lichess link, the settings page tells the player Lichess was disconnected for security and can be connected again.
- **R-91** (S1 close, #251, 2026-10-17): "Profile" means an Account's display name and language (never the Account itself); "Provider link" is a sign-in method linked to an Account. The S1 Lithuanian terms proposed in docs/glossary-lt.md are approved.
- **R-92** (S1 close, #251, 2026-10-17): The nightly full mutation run also runs the feature suite, so rules checked only there are mutation-tested; the per-push run stays fast.
- **R-93** (S1 close, #251, 2026-10-17): The persona test sign-in (R-73) may be enabled on local and staging environments; production always refuses it.
- **R-94** (S1 close, #270, 2026-10-17): The admin audit email hash (R-88) is keyed: HMAC-SHA-256 with a per-environment secret (`AUDIT_EMAIL_KEY`), so a leaked database alone cannot confirm a guessed email.
- **R-95** (S1 close, #270, 2026-10-17): Downloading the data export needs a sign-in within the last day, as linking does (R-84).
- **R-96** (S3/S4 brainstorm, #253 #254, 2026-10-17): Slices reshuffled: sharing a player's own repertoire with a linked coach (R-42) moves from S3 to S4; the fork offer on unlink (R-44) moves from S4 to S5. S3 adds PGN export of a repertoire.
- **R-97** (S3/S4 brainstorm, #253 #254, 2026-10-17): The board is chessground (GPL-3.0); the web app's code is GPL-3.0-compatible and the repository stays public.
- **R-98** (S3/S4 brainstorm, #253 #254, 2026-10-17): Two kinds of invite, both unguessable and revocable: a personal invite (single use, for one player) and a group invite (one link usable by many until it expires or is revoked, within the coach's player limit).
- **R-99** (S3/S4 brainstorm, #253 #254, 2026-10-17): An invite is valid for 7 days.
- **R-100** (S3/S4 brainstorm, #253 #254, 2026-10-17): Switching the coach capability off is refused while any player is linked; the page lists the players to unlink first.
- **R-101** (S3/S4 brainstorm, #253 #254, 2026-10-17): A PGN upload creates a new repertoire (side chosen) or adds to an existing repertoire of that side; added games become new chapters and their positions merge into the graph.
- **R-102** (S3/S4 brainstorm, #253 #254, 2026-10-17): On a player's own repertoire, move comments (from PGN or written in the builder) belong to the repertoire: they are exported and a sharing coach sees them. Personal notes are separate and always private (R-21). On a coach's repertoire the coach's comments are Coach notes.
- **R-103** (S3/S4 planning, #253 #254, 2026-10-18): mychess is licensed AGPL-3.0-or-later (compatible with chessground's GPL-3.0-or-later, R-97); the repository has a LICENSE file.
- **R-104** (S3/S4 planning, #253 #254, 2026-10-18): A chapter made in the builder is named from the šachmatai.lt taxonomy by its moves, like an imported one (R-63); "Skyrius N" only while it is too short to classify.
- **R-105** (S3/S4 planning, #253 #254, 2026-10-18): Move comments are kept as one paragraph: line breaks become spaces, so a PGN export re-imports identically.
- **R-106** (S3/S4 planning, #253 #254, 2026-10-18): The data export (R-40) includes coaching data: the player's coach links and shares; for a coach, their groups, invites (state and dates, never tokens) and the coach notes they wrote.
- **R-107** (S3/S4 planning, #253 #254, 2026-10-18): A player sees the Coach notes a coach added to the player's shared repertoire, read-only and marked with the coach's name; they go when sharing ends.
- **R-108** (S3/S4 planning, #253 #254, 2026-10-18): Invites from a disabled coach account are refused with the generic "not valid" message.
- **R-109** (S3/S4 planning, #253 #254, 2026-10-18): When a coach with no linked players switches Coach mode off, their open invites are revoked at once and their groups are kept.
- **R-110** (S3/S4 planning, #253 #254, 2026-10-18): A personal invite may optionally name a group; a group invite always names one.
- **R-111** (S3/S4 resume, #253, 2026-10-18): In a repertoire with no chapters, the first move played in the builder creates the first chapter and saves the move in it, in one step; there is no separate "Add chapter" step first.
- **R-112** (S3/S4 resume, #253, 2026-10-18): Chapter intros are read-only in S3: the builder shows an imported intro but cannot edit it.
- **R-113** (S3/S4 resume, #254, 2026-10-18): While Coach mode is off, the coach's groups are read-only: renaming, deleting and changing members are refused until Coach mode is on again. With Coach mode off there is no coach dashboard: the groups are kept out of sight until Coach mode is on again.
- **R-114** (S3/S4 resume, #254, 2026-10-18): A coach has at most 50 open invites; creating another is refused until one expires, is used or is revoked.
- **R-115** (S3 review, #253, 2026-10-18): Importing a PGN into an existing repertoire is refused when nothing in the file can be added (every game refused against it); the repertoire is not touched.
- **R-116** (S3 review, #253, 2026-10-18): On the repertoire page an empty personal note shows as a single "Mano užrašas" button that opens the field (a written note stays open), and a repertoire with one chapter starts with its chapter list closed.
- **R-117** (S3 review, #253, 2026-10-19): When importing into an existing repertoire, a game that adds no new move (its moves are all refused or already there) adds no chapter; if no game adds a move, the import is refused (R-115).
- **R-118** (S3 review, #253, 2026-10-19): Lithuanian terms: a move Comment is "komentaras" (a move thread is "pokalbis apie ėjimą"); the repertoire edit mode is "Redaguoti" / "Edit"; a Personal note is "užrašas" ("Mano užrašas"); an untitled chapter is "Skyrius N".
- **R-119** (S3 security review, #253, 2026-10-19): A PGN upload also has a limit of 50,000 half-moves in total (extends R-66), and an account may run at most 10 import previews or confirms a minute.
- **R-120** (S3/S4 language review, #253 #254, 2026-10-19): Terms: a ply is "pusėjimis" in Lithuanian and "half-move" in player-facing English; a Player in a coach's Group is "grupės žaidėjas" ("Grupės žaidėjai").
- **R-121** (S3 close, #253, 2026-10-19): For reconciliation (R-23), a changed Move means a Move added or removed; editing a Move's comment, arrows or circles never resets a player's training on it.
- **R-122** (S3 close, #253, 2026-10-19): R-117 judges each imported game against the repertoire and the earlier games of the same file: a game that adds no move beyond them adds no chapter.
- **R-123** (S3 close, #253, 2026-10-19): Exporting a repertoire and importing it again keeps its moves, comments and marks; chapter names may be re-derived from the taxonomy on import (R-63, R-104).
- **R-124** (S4 Part B, #254, 2026-10-20): A coach's notes on a player's shared repertoire are deleted when that sharing ends, by unsharing or by unlinking (R-107); R-47's "notes are kept" applies to assigned repertoires, not shared ones.
- **R-125** (S4 Part B, #254, 2026-10-20): A coach sees only their own notes on a shared repertoire; the player sees every coach's notes, each marked with the coach's name.
- **R-126** (S4 Part B, #254, 2026-10-20): In the data export (R-106) a coach's notes list position, move, text and dates without the player or repertoire; a player's export does not include notes coaches wrote on the player's repertoires.
- **R-127** (S4 Part B language review, #254, 2026-10-20): Sharing a repertoire with a coach is "bendrinti" ("bendrinama su # treneriu / treneriais / trenerių", "nebendrinama", "nebebendrinti", "Bendrinami repertuarai"); a coach's own note field is "Mano pastaba" / "My coach note", shown to the player as "Trenerio pastaba — {name}".
- **R-128** (S5 brainstorm, #255, 2026-10-20): A fork replaces the live assignment: the live repertoire leaves the player's list, the coach sees the assignment as "forked", and the coach's later edits no longer reach that player. The coach may assign it again.
- **R-129** (S5 brainstorm, #255, 2026-10-20): An assignment is done when every own-side move has been learned (learn pass finished or "I know this"). A done assignment is never overdue; a coach edit that adds moves makes it not done again.
- **R-130** (S5 brainstorm, #255, 2026-10-20): A coach unassigning a repertoire works like unlink (R-44): it disappears from the player's list, its Reviews go dormant, and a fork offer stays open for 30 days. Players who also have it individually keep it (R-16).
- **R-131** (S5 brainstorm, #255, 2026-10-20): A coach may delete an assigned repertoire. Deleting unassigns it from everyone first (R-130); the confirm dialog says how many players have it.
- **R-132** (S5 brainstorm, #255, 2026-10-20): A paused assignment whose deadline passes is still overdue; the coach sees both and can extend or clear the deadline.
- **R-133** (S5 brainstorm, #255, 2026-10-20): An assigned repertoire shows "Updated" after a coach edit until the player opens it; opening it shows what changed since their last visit (moves added and removed, by chapter).
- **R-134** (S5 brainstorm, #255, 2026-10-20): When a player has a repertoire both individually and through a group, the individual assignment's deadline (or its absence) applies.
- **R-135** (S5 close, #255, 2026-10-21): S5 terms (docs/glossary-lt.md): Assignment "priskyrimas" (unassign "Panaikinti priskyrimą"); Deadline "terminas"; Overdue "Pradelsta"; Paused "Pristabdyta"; Updated "Atnaujinta"; Fork "asmeninė kopija" / "own copy" ("Pasidaryti asmeninę kopiją" / "Make my own copy"); fork offers "Kopijos, kurias galite pasilikti" / "Copies you can keep"; the home section "Jums priskirti repertuarai".
- **R-136** (S5 close, #255, 2026-10-21): A player who reaches an assignment through a group they joined later sees "Updated" (R-133) only for coach edits made after they joined.
- **R-137** (S5 close, #255, 2026-10-21): When a coach deletes their account, every live assignment gets its automatic fork (R-49), even if the player forked the same repertoire before and was assigned it again.
- **R-138** (S5 close, #255, 2026-10-21): With Coach mode off, a coach's assignments are frozen like groups (R-113): unassigning and changing deadlines are refused. Deleting their own repertoire still works and unassigns it from everyone (R-131).
- **R-139** (S5 close, #255, 2026-10-21): A player's data export (R-40) also lists their assignments (coach, repertoire name, effective deadline, paused) and their open fork offers (repertoire name, coach, expiry).
- **R-140** (S5 close, #255, 2026-10-21): When a player forks, their personal notes are copied into the fork and the originals stay on the coach's repertoire, dormant and private; they return if it is assigned again.
- **R-141** (S5 close, #255, 2026-10-21): A fork's read-only coach notes are part of the player's own copy and are in the player's data export (an exception to R-126, which covers notes on shared repertoires).
- **R-142** (S6 brainstorm, #256, 2026-10-23): Review runs at two scopes: "today's review" on home over every repertoire the player trains (most urgent first), and per repertoire from its page. Session size and the daily new-move limit are per player.
- **R-143** (S6 brainstorm, #256, 2026-10-23): A review item opens at its position with the line so far shown; after a correct answer the opponent replies, and if the next own move on that line is also in the session it is asked at once, otherwise the next item loads.
- **R-144** (S6 brainstorm, #256, 2026-10-23): The learn pass goes through a line twice: first from the start with arrows on new moves (opponent moves automatic, learned own moves played ungraded), then blind; a wrong new move goes back to its arrow. The daily limit may cut a line; it continues the next day.
- **R-145** (S6 brainstorm, #256, 2026-10-23): New moves started from home come from assignments with a deadline (earliest first), then other assignments, then own repertoires, each in line order; from a repertoire page, only that repertoire.
- **R-146** (S6 brainstorm, #256, 2026-10-23): Players set the session size (10-100, default 20) and new moves a day (0-50, default 10; 0 = review only). The day runs midnight to midnight in the player's time zone.
- **R-147** (S6 brainstorm, #256, 2026-10-23): "I know this" on a line or chapter confirms with the move count; "Learn again" returns skipped moves never reviewed to "to learn". Skipped moves do not count toward the daily new-move limit.
- **R-148** (S6 close, #256, 2026-10-26): S6 terms (docs/glossary-lt.md): the training page "Treniruotė" at `/treniruote`; home review "Šiandienos kartojimas" / "Today's review" ("Pradėti kartojimą"); the learn button "Mokytis # naujo ėjimo / naujų ėjimų" / "Learn # new moves" (not "Išmokti"); the learn pass's two rounds have no UI name, only the prompts "Sužaiskite ėjimą, kurį rodo rodyklė" / "Play the move the arrow shows" and "Dabar be rodyklės" / "Now without the arrow"; a wrong move "Ne tas ėjimas" / "Not that move", a right one "Teisingai" / "Correct", lapses counted as "suklydimai"; "Užuomina" / "Hint"; "Baltųjų ėjimas" / "White to move"; "Žinau šį ėjimą / variantą / skyrių" confirmed with "Pažymėti, kad žinote # ėjimų?"; "Mokytis iš naujo" / "Learn again"; the two-answers notice "Kituose jūsų repertuaruose čia žaidžiamas kitas ėjimas:"; the unsaved-results banner "# rezultatų dar neišsaugota. Bandysime toliau." ("Bandyti dabar"); settings "Kartojimų per sesiją" / "Reviews per session" and "Naujų ėjimų per dieną" / "New moves a day".
- **R-149** (S6 close, #256, 2026-10-26): In code, "drill" may name the training screen's interactive session (ReviewDrill, LearnDrill, drill-panel); domain text keeps Review. Recorded in CONTEXT.md.
- **R-150** (S6 close, #256, 2026-10-26): A generated migration may be completed by hand only where drizzle-kit leaves a placeholder it cannot fill (dropping a primary key by name), before the migration reaches staging; docs/operations.md "Replacing a primary key" records how.
- **R-151** (S7 brainstorm, #257, 2026-10-26): The coach sees each own-side move of a repertoire in exactly one state: not started (no review), skipped ("I know this", never graded), due (review due now), learned (scheduled, not due). Mastered (R-56) is a badge on a line, chapter or repertoire, not a state.
- **R-152** (S7 brainstorm, #257, 2026-10-26): Coach progress drills down from the repertoire to its chapters, and from a chapter to its lines.
- **R-153** (S7 brainstorm, #257, 2026-10-26): The group page shows a grid: one row per group player, one column per repertoire assigned to the group; each cell holds % learned, the due count and the badges, and opens that player's progress on it.
- **R-154** (S7 brainstorm, #257, 2026-10-26): The coach sees when a player last trained, counted only from results on repertoires the coach may see progress on. Streaks wait for M2.
- **R-155** (S7 brainstorm, #257, 2026-10-26): A forked assignment shows the coach only its own-copy badge, no progress (R-39); a shared fork (R-42) shows its progress like any shared repertoire.
- **R-156** (S7 security review, #257, 2026-10-26): Coach progress shows whether the player knows each move the coach can see, wherever they trained it: a Review is one per player and move (R-53), so training on a private repertoire or a fork counts on an overlapping assigned or shared move. The coach still sees only the moves of repertoires they assigned or that were shared with them, never the private repertoire's other moves, name or training times (R-154 stays filtered).
- **R-157** (S7 close, #257, 2026-10-27): S7 terms (docs/glossary-lt.md): progress "pažanga" ("Pažanga", route slug `pazanga`); the four move states as one line "{N} išmokta · # kartotinas/-i/-ų · {N} pažymėta „Žinau“ · {N} liko išmokti" / "learned · due · marked as known · to learn"; Mastered "Įvaldyta"; last trained "Paskutinį kartą treniravosi šiandien / vakar / prieš # dieną, dienas, dienų", never "Dar nesitreniravo"; the group grid "Grupės pažanga" with column "Žaidėjas", an empty cell "Nepriskirta" and "{N} % išmokta"; nothing to learn "Nėra ko mokytis".
- **R-158** (#301, 2026-10-28): When two chapters of one repertoire would show the same title, each shows its opening's ECO code and the first move where it differs from the others, e.g. "Karo-Kano gynyba (B12, 3. e5)". It applies wherever chapter titles show, the PGN import preview included (owner, 2026-10-28); PGN and data exports keep plain names.

## Open questions

- **Brand and domain** (R-10): pending before the production launch.
