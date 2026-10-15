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
- **R-30** (Q16, #226, 2026-10-16): Stack as sportbet_new: pnpm monorepo, Next.js 16 in `apps/web`, `packages/{domain,chess,db}`, Drizzle, Neon Postgres, Auth.js (magic link + Google).
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

## Open questions

Details the rulings leave open. Not decided here; each needs an owner answer or lead fact-finding before the slice that depends on it.

1. **LSF ratings source** (R-25): fact-finding done in #232. LŠF publishes no national rating; its ratings page links to the FIDE list filtered to LTU. Proposal: show a Lithuania ranking built from FIDE-LTU data. Needs owner confirmation.
2. **Lichess sign-in timing** (R-26 vs R-5, R-29): R-5 puts auth in M1 and R-29 ports Lichess OAuth "when M3 starts". Is Lichess sign-in M1 or M3? Is Chess.com linking-only (no sign-in)?
3. **Sharing a private repertoire** (R-39): what "shared" means for a player's own repertoire (with one coach, all coaches, read-only or assignable) and how it is done.
4. **Fork and progress** (R-20, R-40): does a fork carry the player's FSRS progress over, and does the coach keep any visibility of a forked copy of their assignment?
5. **Unlink without fork** (R-40): if the player declines the offered fork, does the live-linked repertoire disappear from their account, and is its progress kept anywhere?
6. **Leaving a group** (R-16): when a group assignment is removed because the player left, is the player's progress on it kept (for a later re-join) or offered as a fork as on unlink?
7. **Shared moves across repertoires** (R-19, R-22): if the same move from the same position sits in two of a player's repertoires (for example, assigned by two coaches), is that one review card or two?
8. **Transposition scope** (R-19): transpositions merge within a repertoire; do they also merge across chapters' boundaries for chapter-level stats, and across repertoires of the same side?
9. **Learn pass completion** (R-22): what ends the learn pass for a move (one clean blind retest, or more), and how free play affects FSRS state (if at all).
10. **Mastery goal and weak spots** (R-14, R-17): what counts as a line or chapter being "mastered" under FSRS, and how weak spots are computed.
11. **Results goal** (R-17, R-24): does "no deviations in the next N games" count only player mistakes, or also opponent-left-book events?
12. **Missed deadlines** (R-15, R-16): what happens when an assignment deadline passes (notice only, dashboard flag, nothing).
13. **Coach update notice** (R-23): is the "coach updated" notice a regular notification (in-app + digest), and does it apply to group members too?
14. **Entitlement seam** (R-3): what the first entitlement checks will gate, if anything, beyond existing as a seam.
15. **v1 user migration** (R-6): who decides whether v1 users are "real", and when.
16. **Brand and domain** (R-10): pending before production launch.
